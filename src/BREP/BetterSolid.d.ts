type RuntimeMetadata = Record<string, any>;

export class Solid {
  [key: string]: any;

  name: string;
  type: string;
  children: any[];
  parent: any;
  userData: RuntimeMetadata;

  constructor(...args: any[]);

  static unionMany(...args: any[]): any;

  add(...objects: any[]): this;
  remove(...objects: any[]): this;
  traverse(visitor: (object: any) => void): void;
  updateMatrixWorld(force?: boolean): void;
  getObjectByName(name: string): any;
}

export const Edge: any;
export const Face: any;
export const Vertex: any;
