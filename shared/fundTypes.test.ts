import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inferFundType } from './fundTypes';

describe('inferFundType', () => {
  it('accepts a type written as text in our own layout', () => {
    assert.deepEqual(inferFundType('Work fund', 'קרן השתלמות', true), { type: 'education_fund', guessed: false });
    assert.deepEqual(inferFundType('Mine', 'Provident fund', true), { type: 'provident_fund', guessed: false });
    assert.deepEqual(inferFundType('X', 'investment_provident_fund', true), { type: 'investment_provident_fund', guessed: false });
  });

  it('lets the name win over legacy types from old exports', () => {
    assert.equal(inferFundType('פנסיה משלימה', 'retirement').type, 'pension_supplementary');
    assert.equal(inferFundType('קרן השתלמות עצמאיים', 'savings').type, 'education_fund');
  });
});
