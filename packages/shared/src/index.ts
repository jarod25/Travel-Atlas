/** Provenance is tracked independently of route geometry. */
export type ConfidenceLevel = 'confirmed' | 'estimated' | 'unknown';

export type TransportMode =
  | 'walking'
  | 'hiking'
  | 'cycling'
  | 'train'
  | 'metro'
  | 'tram'
  | 'car'
  | 'bus'
  | 'taxi'
  | 'plane'
  | 'boat'
  | 'ferry';

/**
 * A computed path is a proposal, even if it visually follows the network.
 * Confirming a historical journey requires separate supporting evidence.
 */
export function calculatedRouteConfidence(): ConfidenceLevel {
  return 'estimated';
}
