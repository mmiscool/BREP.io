import { startStartupTour } from '../startupTour.js';

export function createGuidedTourButton(viewer) {
  if (!viewer) return null;

  return {
    label: 'tour',
    title: 'Start guided tour',
    global: true,
    onClick: async () => {
      try {
        await startStartupTour(viewer);
      } catch (error) {
        try {
          console.warn('Failed to start guided tour:', error);
        } catch {
          // best effort
        }
      }
    },
  };
}
