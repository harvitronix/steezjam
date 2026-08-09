/**
 * Keyboard input. The game reads a flat snapshot of held keys each frame rather
 * than subscribing to events, so simulation code never has to care about event
 * ordering or key-repeat.
 */

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  space: boolean;
}

const BINDINGS: Record<string, keyof Input> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "space",
};

export function createInput(): Input {
  return { left: false, right: false, up: false, down: false, space: false };
}

export interface KeyboardOptions {
  /** Called on the first key or pointer event, for unlocking WebAudio. */
  onFirstInteraction?: () => void;
}

export interface TouchControls {
  left: HTMLElement;
  right: HTMLElement;
  pop: HTMLElement;
}

/**
 * Binds window listeners that keep `input` in sync. Returns a dispose function
 * so the game can be torn down cleanly (embedded in the micro-site, tests, HMR).
 */
export function bindKeyboard(input: Input, opts: KeyboardOptions = {}): () => void {
  const { onFirstInteraction } = opts;

  const down = (e: KeyboardEvent) => {
    onFirstInteraction?.();
    const k = BINDINGS[e.code];
    if (k) {
      input[k] = true;
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => {
    const k = BINDINGS[e.code];
    if (k) {
      input[k] = false;
      e.preventDefault();
    }
  };
  // Alt-tabbing away must not leave a key stuck down.
  const clear = () => {
    input.left = input.right = input.up = input.down = input.space = false;
  };
  const pointer = () => onFirstInteraction?.();

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  window.addEventListener("pointerdown", pointer);

  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
    window.removeEventListener("pointerdown", pointer);
  };
}

/** Maps held pointers onto the same input snapshot used by the keyboard. */
export function bindTouch(input: Input, buttons: TouchControls): () => void {
  type TouchKey = "left" | "right" | "space";

  const held = new Map<number, TouchKey>();
  const bindings: Array<[HTMLElement, TouchKey]> = [
    [buttons.left, "left"],
    [buttons.right, "right"],
    [buttons.pop, "space"],
  ];

  const downs = bindings.map(([button, key]) => {
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      held.set(e.pointerId, key);
      input[key] = true;
      e.preventDefault();
    };
    button.addEventListener("pointerdown", down);
    return down;
  });

  const release = (e: PointerEvent) => {
    const key = held.get(e.pointerId);
    if (!key) return;
    held.delete(e.pointerId);
    input[key] = [...held.values()].includes(key);
    e.preventDefault();
  };
  const clear = () => {
    held.clear();
    input.left = input.right = input.space = false;
  };

  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", clear);

  return () => {
    bindings.forEach(([button], i) => button.removeEventListener("pointerdown", downs[i]));
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    window.removeEventListener("blur", clear);
  };
}
