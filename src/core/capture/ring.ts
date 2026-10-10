export const RING_CAP = 50;

export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly cap = RING_CAP) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }
  toArray(): T[] {
    return this.items.slice();
  }
}
