import {
    manifoldBuildSource,
    manifoldHasCustomExtensions,
    manifoldPlusSum,
} from '../BREP/setupManifold.js';

export async function test_manifoldPlus_sum() {
    if (manifoldBuildSource !== 'local' || !manifoldHasCustomExtensions) {
        return;
    }
    const result = manifoldPlusSum(2, 3);
    if (result !== 5) {
        throw new Error(`Expected manifoldPlusSum(2, 3) to equal 5, received ${result}.`);
    }
}
