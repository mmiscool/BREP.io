export class DigraphABSegment {
  id: string;
  firstPoint: string;
  firstSide: string;
  secondPoint: string;
  secondSide: string;
  weight: number;

  constructor(id: string, firstPoint: string, firstSide: string, secondPoint: string, secondSide: string, weight: number) {
    this.id = id;
    this.firstPoint = firstPoint;
    this.firstSide = firstSide;
    this.secondPoint = secondPoint;
    this.secondSide = secondSide;
    this.weight = weight;
    checkSegment(this);
  }
}

export class DigraphABPointPair {
  id: string | null;
  startPoint: string;
  endPoint: string;
  route: any;
  wireInfo: any;

  constructor(startPoint: string, endPoint: string, id: string | null = null, wireInfo: any = null) {
    this.id = id; // - optional
    this.startPoint = startPoint;
    this.endPoint = endPoint;
    this.route = null;
    this.wireInfo = wireInfo;
  }

  briefClone() {
    const result = new DigraphABPointPair(this.startPoint, this.endPoint, this.id, this.wireInfo);
    if (this.route != null) {
      result.route = this.route.briefClone();
    }
    return result;
  }
}

export function checkSegment(segment: any) {
  if (!segment.id)
    throw "No id attribute in segment " + JSON.stringify(segment);
  if (!segment.weight)
    throw "No weight attribute in segment " + JSON.stringify(segment);
  if (!segment.firstPoint)
    throw "No firstPoint attribute in segment " + JSON.stringify(segment);
  if (!segment.firstSide)
    throw "No firstSide attribute in segment " + JSON.stringify(segment);
  if (segment.firstSide != "A" && segment.firstSide != "B")
    throw "Invalid firstSide attribute '" + segment.firstSide
    + "' (not 'A' or 'B') in segment " + JSON.stringify(segment);
  if (!segment.secondPoint) throw "No secondPoint attribute in segment " + JSON.stringify(segment);
  if (!segment.secondSide) throw "No secondSide attribute in segment " + JSON.stringify(segment);
  if (segment.secondSide != "A" && segment.secondSide != "B")
    throw "Invalid secondSide attribute '" + segment.secondSide
    + "' (not 'A' or 'B') in segment " + JSON.stringify(segment);
}
