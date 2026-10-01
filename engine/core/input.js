// Keyboard state shared by play and build mode. Keys typed into text fields are ignored.
const isTyping = (t) => !!t?.closest?.('input, textarea, select, [contenteditable]');

export class Input {
  constructor() {
    this.down = new Set();
    this.handlers = [];
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      if (!e.repeat) for (const h of this.handlers) h(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('devchat:focus', () => this.clear());
  }

  has(code) {
    return this.down.has(code);
  }

  any(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  clear() {
    this.down.clear();
  }

  // Called once per key press (not on auto-repeat).
  onPress(fn) {
    this.handlers.push(fn);
  }

  // Movement intent in the shape the player controller expects.
  movement() {
    return {
      fwd: this.any('KeyW', 'ArrowUp'),
      back: this.any('KeyS', 'ArrowDown'),
      left: this.any('KeyA', 'ArrowLeft'),
      right: this.any('KeyD', 'ArrowRight'),
      sprint: this.any('ShiftLeft', 'ShiftRight'),
      jump: this.has('Space'),
      down: this.has('KeyC'),
    };
  }
}
