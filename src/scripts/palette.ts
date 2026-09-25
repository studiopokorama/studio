export interface Command {
  name: string;
  hint: string;
  /** Return lines to print; return `{ close: true }` to dismiss the palette and let the page show the result. */
  run: () => string[] | { close: true };
}

/** A small command line for the curious: ⌘K, Ctrl+K or "/" opens it. */
export function createPalette(dialog: HTMLDialogElement, commands: Command[]) {
  const input = dialog.querySelector<HTMLInputElement>("[data-palette-input]");
  const list = dialog.querySelector<HTMLUListElement>("[data-palette-list]");
  const log = dialog.querySelector<HTMLElement>("[data-palette-log]");
  if (!input || !list || !log) throw new Error("palette markup is incomplete");
  let matches: Command[] = [];
  let active = 0;

  const print = (lines: string[], cls = "") => {
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      if (cls) p.className = cls;
      log.append(p);
    }
    log.scrollTop = log.scrollHeight;
  };

  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    matches = commands.filter((c) =>
      c.name.startsWith(q.split(/\s+/)[0] ?? ""),
    );
    active = Math.min(active, Math.max(0, matches.length - 1));
    list.replaceChildren(
      ...matches.map((c, i) => {
        const li = document.createElement("li");
        li.id = `palette-opt-${c.name}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        li.innerHTML = `<span class="cmd"></span><span class="hint"></span>`;
        li.querySelector(".cmd")!.textContent = c.name;
        li.querySelector(".hint")!.textContent = c.hint;
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          execute(c.name);
        });
        return li;
      }),
    );
    input.setAttribute(
      "aria-activedescendant",
      matches[active] ? `palette-opt-${matches[active]!.name}` : "",
    );
  };

  const execute = (raw: string) => {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    print([`› ${name}`], "echo");
    const cmd =
      commands.find((c) => c.name === name) ??
      (matches.length === 1 ? matches[0] : undefined);
    input.value = "";
    active = 0;
    if (!cmd) {
      print([`There's no "${name}" command. Pick one from the list.`], "error");
    } else {
      const out = cmd.run();
      if ("close" in out) dialog.close();
      else print(out);
    }
    renderList();
  };

  input.addEventListener("input", () => {
    active = 0;
    renderList();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!matches.length) return;
      active =
        (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
        matches.length;
      renderList();
    } else if (e.key === "Tab" && matches[active]) {
      e.preventDefault();
      input.value = matches[active]!.name;
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const typed = input.value.trim();
      execute(
        typed && commands.some((c) => c.name === typed.toLowerCase())
          ? typed
          : (matches[active]?.name ?? typed),
      );
    }
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // backdrop click
  });

  const open = () => {
    if (dialog.open) return;
    dialog.showModal();
    input.value = "";
    active = 0;
    renderList();
    input.focus();
  };

  document.addEventListener("keydown", (e) => {
    const typing =
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (
      (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
      (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)
    ) {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });

  return { open, print };
}
