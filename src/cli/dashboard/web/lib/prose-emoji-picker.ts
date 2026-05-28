import { EMOJI_CATEGORIES } from './prose-emoji-data.ts';

// Self-contained emoji picker popover. Pure DOM (no Preact) so it can mount
// inside a ProseMirror NodeView without dragging the UI framework into the
// editor's critical path — same convention as prose-insert-menu.ts.

export interface EmojiPickerOptions {
  onSelect: (emoji: string) => void;
}

export class EmojiPicker {
  readonly dom: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private open_ = false;
  private readonly onDocMousedown: (event: MouseEvent) => void;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(options: EmojiPickerOptions) {
    const root = document.createElement('div');
    root.className = 'proseEmojiPicker';
    root.style.position = 'fixed';
    root.hidden = true;
    this.dom = root;

    this.search = document.createElement('input');
    this.search.type = 'text';
    this.search.className = 'proseEmojiSearch';
    this.search.placeholder = 'Search emoji';
    this.search.addEventListener('input', () => this.renderGrid());
    this.search.addEventListener('mousedown', (e) => e.stopPropagation());
    root.appendChild(this.search);

    this.grid = document.createElement('div');
    this.grid.className = 'proseEmojiGrid';
    root.appendChild(this.grid);

    // Build a click button per emoji once; search just toggles visibility.
    this.grid.addEventListener('mousedown', (event) => {
      // Keep the editor selection; don't let the picker steal focus.
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('button.proseEmojiItem');
      if (!(button instanceof HTMLElement)) return;
      const emoji = button.dataset.emoji;
      if (!emoji) return;
      options.onSelect(emoji);
      this.close();
    });

    this.onDocMousedown = (event: MouseEvent): void => {
      if (!this.open_) return;
      const t = event.target;
      if (t instanceof Node && root.contains(t)) return;
      this.close();
    };
    this.onKeyDown = (event: KeyboardEvent): void => {
      if (this.open_ && event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    };

    this.renderGrid();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(anchor: HTMLElement): void {
    if (this.open_) return;
    if (!this.dom.isConnected) document.body.appendChild(this.dom);
    this.open_ = true;
    this.dom.hidden = false;
    this.search.value = '';
    this.renderGrid();
    this.position(anchor);
    document.addEventListener('mousedown', this.onDocMousedown);
    document.addEventListener('keydown', this.onKeyDown, true);
    setTimeout(() => this.search.focus(), 0);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.dom.hidden = true;
    document.removeEventListener('mousedown', this.onDocMousedown);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  destroy(): void {
    this.close();
    this.dom.remove();
  }

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    // Measure after unhiding so dimensions are real.
    const pickerRect = this.dom.getBoundingClientRect();
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + pickerRect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - pickerRect.width);
    }
    if (top + pickerRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - pickerRect.height - 4);
    }
    this.dom.style.left = `${left}px`;
    this.dom.style.top = `${top}px`;
  }

  private renderGrid(): void {
    const query = this.search.value.trim().toLowerCase();
    this.grid.replaceChildren();

    if (query) {
      const matches: (readonly [string, string])[] = [];
      for (const category of EMOJI_CATEGORIES) {
        for (const entry of category.emojis) {
          if (entry[1].includes(query)) matches.push(entry);
        }
      }
      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'proseEmojiEmpty';
        empty.textContent = 'No emoji found';
        this.grid.appendChild(empty);
        return;
      }
      this.grid.appendChild(this.buildRow(matches));
      return;
    }

    for (const category of EMOJI_CATEGORIES) {
      const heading = document.createElement('div');
      heading.className = 'proseEmojiCategory';
      heading.textContent = category.name;
      this.grid.appendChild(heading);
      this.grid.appendChild(this.buildRow(category.emojis));
    }
  }

  private buildRow(entries: readonly (readonly [string, string])[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'proseEmojiRow';
    for (const [emoji, keywords] of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'proseEmojiItem';
      button.dataset.emoji = emoji;
      button.title = keywords.split(' ')[0] ?? emoji;
      button.textContent = emoji;
      row.appendChild(button);
    }
    return row;
  }
}
