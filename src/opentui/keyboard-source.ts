export interface OpenTuiKeyEvent {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
}

export interface OpenTuiKeyboardSource {
  subscribe(handler: (key: OpenTuiKeyEvent) => void): () => void;
  dispose(): void;
}

interface KeyInputEmitter {
  on(event: "keypress", handler: (key: OpenTuiKeyEvent) => void): void;
  off(event: "keypress", handler: (key: OpenTuiKeyEvent) => void): void;
}

export function createBufferedKeyboardSource(keyInput: KeyInputEmitter): OpenTuiKeyboardSource {
  const subscribers = new Set<(key: OpenTuiKeyEvent) => void>();
  const pending: OpenTuiKeyEvent[] = [];
  const listener = (key: OpenTuiKeyEvent): void => {
    if (subscribers.size === 0) {
      pending.push(key);
      return;
    }
    for (const subscriber of subscribers) {
      subscriber(key);
    }
  };

  keyInput.on("keypress", listener);

  return {
    subscribe(handler) {
      subscribers.add(handler);
      while (pending.length > 0) {
        const key = pending.shift();
        if (key) {
          handler(key);
        }
      }
      return () => {
        subscribers.delete(handler);
      };
    },
    dispose() {
      subscribers.clear();
      pending.length = 0;
      keyInput.off("keypress", listener);
    },
  };
}
