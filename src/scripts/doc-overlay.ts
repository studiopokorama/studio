import { SITE_NAME } from "../config";
import { plainClick } from "./project-overlay";

interface DocRef {
  id: string;
  title: string;
  path: string;
}

/** Matches the frame's fade-out in the CSS (.po.is-leaving). */
const LEAVE_MS = 240;

/**
 * Privacy, terms, about: full-screen over the home page, like a project. Each has its own URL
 * (/<slug>/): opening pushes it, closing goes back, landing on one starts with it open.
 */
export class DocOverlay {
  private docs: DocRef[];
  private current: string | null = null;
  /** True when opening added a history entry, so closing should go back rather than replace. */
  private pushed = false;
  private leaving = false;
  private body: HTMLElement;
  private frame: HTMLElement;

  constructor(
    private dialog: HTMLDialogElement,
    private opts: { reducedMotion: boolean },
  ) {
    this.docs = JSON.parse(dialog.dataset.docs ?? "[]");
    this.body = need(dialog, "[data-body]");
    this.frame = need(dialog, "[data-frame]");

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault(); // Esc: close with the fade and the history step
      this.close();
    });
    dialog.addEventListener("click", (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>(
        "[data-close], [data-doc]",
      );
      if (!a || !plainClick(e)) return;
      e.preventDefault();
      if (a.hasAttribute("data-close")) this.close();
      else this.show(a.dataset.doc!, { history: "replace" });
    });
    window.addEventListener("popstate", () => {
      this.pushed = false;
      const id = this.idFromPath(location.pathname);
      if (id) this.show(id, { history: "none" });
      else if (this.current) void this.dismiss();
    });

    // Landed on /<slug>/: rendered open (non-modal, for no-JS). Make it modal.
    if (dialog.open) {
      const view = this.body.querySelector<HTMLElement>("[data-doc-view]");
      dialog.close();
      if (view?.dataset.docView) {
        this.current = view.dataset.docView;
        dialog.showModal();
      }
    }
  }

  get isOpen() {
    return this.current !== null;
  }

  /** Open a page (from the footer links). */
  open(id: string) {
    this.show(id, { history: "push" });
  }

  private show(
    id: string,
    { history: step }: { history: "push" | "replace" | "none" },
  ) {
    const ref = this.ref(id);
    if (this.leaving) return;
    if (id !== this.current) {
      const tpl = document.querySelector<HTMLTemplateElement>(
        `template[data-doc-template="${CSS.escape(id)}"]`,
      );
      const view = tpl?.content.firstElementChild?.cloneNode(true);
      if (!(view instanceof HTMLElement))
        throw new Error(`no view for page ${id}`);
      this.body.replaceChildren(view);
      this.frame.scrollTop = 0;
      this.replayEntrance();
    }
    const wasOpen = this.current !== null;
    this.current = id;
    this.dialog.setAttribute("aria-labelledby", `doc-${id}`);
    for (const a of this.dialog.querySelectorAll<HTMLElement>("[data-doc]")) {
      if (a.dataset.doc === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = `${ref.title} | ${SITE_NAME}`;
    if (!this.dialog.open) this.dialog.showModal();
    if (step === "push" && !wasOpen) {
      history.pushState({ doc: id }, "", ref.path);
      this.pushed = true;
    } else if (step !== "none") {
      // Switching pages inside the overlay: back still closes it.
      history.replaceState({ doc: id }, "", ref.path);
    }
  }

  /** Close with a history step: back when the open added one, else replace the URL with the home page. */
  close() {
    if (!this.current || this.leaving) return;
    if (this.pushed && history.state?.doc)
      history.back(); // popstate dismisses
    else {
      history.replaceState(null, "", "/");
      void this.dismiss();
    }
  }

  private async dismiss() {
    if (!this.current || this.leaving) return;
    this.leaving = true;
    this.pushed = false;
    if (!this.opts.reducedMotion) {
      this.dialog.classList.add("is-leaving");
      await new Promise((r) => setTimeout(r, LEAVE_MS));
    }
    this.dialog.close();
    this.dialog.classList.remove("is-leaving");
    this.body.replaceChildren();
    this.current = null;
    document.title = SITE_NAME;
    this.leaving = false;
  }

  private replayEntrance() {
    if (this.opts.reducedMotion) return;
    this.dialog.classList.remove("is-entering");
    void this.dialog.offsetWidth; // restart the CSS animation
    this.dialog.classList.add("is-entering");
  }

  private ref(id: string): DocRef {
    const ref = this.docs.find((d) => d.id === id);
    if (!ref) throw new Error(`unknown page ${id}`);
    return ref;
  }

  private idFromPath(path: string): string | null {
    return this.docs.find((d) => d.path === path)?.id ?? null;
  }
}

function need<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  sel: string,
): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}
