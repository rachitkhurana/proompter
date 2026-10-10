import { Component } from "react";

function track<T>(target: T): T {
  return target;
}

function logged(_target: object, _key: string, descriptor: PropertyDescriptor) {
  return descriptor;
}

@track
export class Decorated extends Component {
  @logged
  handle() {
    return 1;
  }

  render() {
    return <section onClick={() => this.handle()}>decorated</section>;
  }
}
