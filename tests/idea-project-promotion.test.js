"use strict";
const { describe, it, assert } = require('./harness');
const S = require('../tools/schema-objects');
const P = require('../tools/idea-project-promotion');

function idea(status = 'exploring') {
  return S.createObject('idea', {
    title: 'Au/CeO2 光催化', status, summary: '界面作用研究', hotspots: ['电荷转移'],
    gaps: ['缺少原位光谱'], key_papers: [], promoted_to: '',
  }, { now: '2026-08-20T00:00:00.000Z', display_id: 'IDEA-007', uid: S.uuidV7(1) });
}

describe('M3 Idea -> Project promotion builder', () => {
  it('creates a valid schema-v1 Project and profile v0 from an Idea', () => {
    const result = P.buildPromotion({
      idea: idea(), existingDisplayIds: ['PRJ-001'], now: '2026-08-20T01:00:00.000Z', projectUid: S.uuidV7(2),
      input: { boundaries_do: ['验证界面与落盘'], boundaries_dont: ['不把验收对象当研究结论'] },
    });
    assert.eq(result.project.display_id, 'PRJ-002');
    assert.eq(result.project.stage, 'P0');
    assert.eq(result.project.profile_version, 0);
    assert.deepEq(S.validateObject(result.project), []);
    assert.eq(result.promotedIdea.status, 'promoted');
    assert.eq(result.promotedIdea.promoted_to, 'PRJ-002');
    assert.match(result.profileContent, /artifact: "project_profile"/);
    assert.match(result.profileContent, /profile_version: 0/);
    assert.deepEq(S.parseObject(result.projectContent).object.boundaries, {
      do: ['验证界面与落盘'], dont: ['不把验收对象当研究结论'],
    });
    assert.deepEq(S.parseObject(result.profileContent).object.boundaries, {
      do: ['验证界面与落盘'], dont: ['不把验收对象当研究结论'],
    });
  });

  it('refuses shelved and already-promoted Ideas', () => {
    let shelved = '';
    try { P.buildPromotion({ idea: idea('shelved') }); } catch (error) { shelved = error.message; }
    assert.match(shelved, /idea_must_be_exploring/);
    const promoted = { ...idea(), status: 'promoted', promoted_to: 'PRJ-009' };
    let repeated = '';
    try { P.buildPromotion({ idea: promoted }); } catch (error) { repeated = error.message; }
    assert.match(repeated, /idea_already_promoted/);
  });
});
