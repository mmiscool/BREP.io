type NodeLessFunction<T> = (a: T, b: T) => boolean;

export class MinHeap<T = any> {
  heap: Array<T | null>;
  nodeLessFunction: NodeLessFunction<T>;

  constructor(nodeLessFunction: NodeLessFunction<T> | null = null) {
    // Initialing the array heap and adding a dummy element at index 0
    this.heap = [null];
    this.nodeLessFunction = nodeLessFunction ?? function (a, b) {
      return a < b
    };
  }

  size(): number {
    return this.heap.length - 1;
  }

  isEmpty(): boolean {
    return this.size() <= 0;
  }

  getMin(): T | null {
    return this.heap[1] ?? null;
  }

  checkIntegrity(): void {
    for (let k = 2; k < this.heap.length; k++) {
      // Start from k = 2: element #1 has no parent
      if (this.nodeLessFunction(this.heap[k] as T, this.heap[k >> 1] as T)) {
        throw "Heap damaged: element #" + k + " < #" + (k >> 1);
      }
    }
  }

  insert(node: T): void {
    this.heap.push(node);

    if (this.heap.length > 1) {
      let current = this.heap.length - 1;

      let parent = current >> 1;
      while (current > 1 && this.nodeLessFunction(this.heap[current] as T, this.heap[parent] as T)) {
        this.swap(parent, current);
        current = parent;
        parent = current >> 1;
      }
    }
  }

  remove(): T | null {
    const heapSize = this.size();
    if (heapSize < 0) {
      throw "Assertion: negative heap size " + heapSize;
    }
    if (this.isEmpty()) {
      return null;
    }
    // Smallest element is at the index 1 in the heap array
    const smallest = this.heap[1] as T;
//        console.log("smallest: " + smallest);

    // When there are more than two elements in the array, we put the right most element at the first position
    // and start comparing nodes with the child nodes
    if (this.heap.length > 2) {
      this.heap[1] = this.heap[this.heap.length - 1];
      // - 1st element should be removing; replace it with the last
      this.heap.splice(heapSize);
      // - remove the last element (duplicate)

      if (this.heap.length == 3) {
        if (this.nodeLessFunction(this.heap[2] as T, this.heap[1] as T)) {
          this.swap(1, 2);
        }
        return smallest;
      }

      let current = 1;
      let leftChildIndex = current * 2;
      let rightChildIndex = leftChildIndex + 1;

      // Note: in original version there was a bug: it checked
      // this.heap[...ChildIndex]
      // (will be "false" for number element 0!) instead of correct
      // ...ChildIndex] <= heapSize
      // Moreover, it is possible that only left index is inside heapSide!
      // Note: < , not <= ! heapSize is the size BEFORE removing the last element
      for (; ;) {
        let newCurrent = -1;
        if (this.existsAndLess(rightChildIndex, current)) {
          // So, also leftChildIndex < this.heap.length!
          // No sense to compare leftChildIndex and current:
          // in any case, we will swap with smallest from leftChildIndex and rightChildIndex
          newCurrent = this.nodeLessFunction(this.heap[leftChildIndex] as T, this.heap[rightChildIndex] as T) ?
            leftChildIndex :
            rightChildIndex;
        } else {
          if (this.existsAndLess(leftChildIndex, current)) {
            newCurrent = leftChildIndex;
          } else {
            // Heap is restored
            break;
          }
        }
        this.swap(current, newCurrent);
        current = newCurrent;
        leftChildIndex = current * 2;
        rightChildIndex = leftChildIndex + 1;
      }
    } else {
      // If there are only two elements in the array (in other words, only 1 element in the heap),
      // we directly splice out the first element
      this.heap.splice(1, 1);
    }
    return smallest;
  }

  // private
  existsAndLess(checked: number, other: number): boolean {
    return checked < this.heap.length && this.nodeLessFunction(this.heap[checked] as T, this.heap[other] as T);
  }

  // private
  swap(i: number, j: number): void {
    // Swapping the two nodes by using the ES6 destructuring syntax:
    // works little faster than usual exchange via "temp" variable
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]]
  }
}
