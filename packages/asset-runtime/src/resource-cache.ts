export interface ResourceLease<T> {
  value: T;
  release(): void;
}
interface Entry<T> {
  promise: Promise<T>;
  references: number;
}

/** Share in-flight loads. Dispose exactly once when the last active owner leaves. */
export class ResourceCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly dispose: (value: T) => void,
  ) {}
  async acquire(key: string): Promise<ResourceLease<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { promise: this.load(key), references: 0 };
      this.entries.set(key, entry);
    }
    const owner = entry;
    owner.references += 1;
    try {
      const value = await owner.promise;
      let released = false;
      return {
        value,
        release: () => {
          if (released) return;
          released = true;
          owner.references -= 1;
          if (owner.references === 0) {
            this.entries.delete(key);
            this.dispose(value);
          }
        },
      };
    } catch (error) {
      owner.references -= 1;
      if (this.entries.get(key) === owner) this.entries.delete(key);
      throw error;
    }
  }
  get activeResourceCount(): number {
    return this.entries.size;
  }
}
