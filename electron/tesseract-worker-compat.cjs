function bridgeNodeWorkerOnError(Worker = require('node:worker_threads').Worker) {
  if (!Worker?.prototype || Object.getOwnPropertyDescriptor(Worker.prototype, 'onerror')) return false;

  const handlers = new WeakMap();
  Object.defineProperty(Worker.prototype, 'onerror', {
    configurable: true,
    enumerable: false,
    get() {
      return handlers.get(this) || null;
    },
    set(handler) {
      const previous = handlers.get(this);
      if (previous) this.removeListener('error', previous);
      if (typeof handler !== 'function') {
        handlers.delete(this);
        return;
      }
      const listener = (error) => handler.call(this, error);
      handlers.set(this, listener);
      this.on('error', listener);
    }
  });
  return true;
}

module.exports = { bridgeNodeWorkerOnError };
