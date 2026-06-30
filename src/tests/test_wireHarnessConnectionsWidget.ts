import { findReusableFormboardSheet } from '../UI/wireHarness/WireHarnessConnectionsWidget.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export function test_wire_harness_formboard_reuses_only_formboard_sheet() {
  const plainSheet = {
    id: 'sheet-1',
    name: 'Instruction Sheet',
    elements: [{ id: 'table-1', type: 'table' }],
  };
  const formboardSheet = {
    id: 'sheet-2',
    name: 'Formboard Sheet',
    elements: [{ id: 'line-1', type: 'line', groupId: 'wire-harness-formboard:abc' }],
  };

  assert(
    findReusableFormboardSheet([plainSheet], '') === null,
    'Expected unrelated sheets to be ignored when reusing a formboard target.',
  );
  assert(
    findReusableFormboardSheet([plainSheet, formboardSheet], '')?.id === 'sheet-2',
    'Expected an existing formboard sheet to be reused.',
  );
  assert(
    findReusableFormboardSheet([plainSheet, formboardSheet], 'sheet-1')?.id === 'sheet-2',
    'Expected preferred non-formboard sheets to be ignored in favor of the actual formboard sheet.',
  );
  assert(
    findReusableFormboardSheet([plainSheet, formboardSheet], 'sheet-2')?.id === 'sheet-2',
    'Expected the preferred sheet to be reused when it already contains a formboard.',
  );
}
