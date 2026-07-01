import { Group, type Object3D } from 'three';

type AssemblyComponentOptions = {
  name?: string;
  fixed?: boolean;
};

type VisualizableChild = Object3D & {
  visualize?: () => Promise<void> | void;
  free?: () => Promise<void> | void;
};

export class AssemblyComponent extends Group {
  declare type: string;
  declare name: string;
  declare children: VisualizableChild[];
  declare add: (...objects: any[]) => this;

  fixed: boolean;
  isAssemblyComponent: boolean;

  constructor({ name = 'Component', fixed = false }: AssemblyComponentOptions = {}) {
    super();
    this.type = 'COMPONENT';
    this.name = name;
    this.fixed = !!fixed;
    this.isAssemblyComponent = true;
  }

  addBody(body: any): void {
    if (!body) return;
    try {
      if (!body.type) body.type = 'SOLID';
      this.add(body);
    } catch {
      this.add(body);
    }
  }

  async visualize(): Promise<void> {
    for (const child of this.children as VisualizableChild[]) {
      if (child && typeof child.visualize === 'function') {
        try { await child.visualize(); } catch { /* ignore */ }
      }
    }
  }

  async free(): Promise<void> {
    for (const child of this.children as VisualizableChild[]) {
      if (child && typeof child.free === 'function') {
        try { await child.free(); } catch { /* ignore */ }
      }
    }
  }
}
