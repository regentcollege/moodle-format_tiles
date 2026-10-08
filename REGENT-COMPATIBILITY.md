# Regent Moodle 5.3 compatibility branch

This branch preserves the upstream plugin and its license. It is a Regent-maintained source, not a claim of an upstream merged release.

Based on the unchanged Bitbucket release commit bfbdffb259df9f7c2168c650f4266327fb932084 (version 2026012570). The official ZIP additionally supplies the GPL/template documentation header in templates/tilenumber.mustache; that nonfunctional header is retained to match the qualified release. The GitHub repository mirrors upstream public branches and history; this branch adds compatibility changes separately.

Use native core modal creation promises in activity modals and the icon picker. Guard concurrent creation and permit retry after failure. Restore focus to a replaced completion button only when needed, preserving deliberate focus movement. Source and generated AMD assets are included.

## Validation

Qualified locally on Moodle 5.3.0 with synthetic controls/content. Compiled AMD tests cover promise API behavior, double click during delayed creation, rejection/retry and applicable initialization return contracts. Native browser checks exercised activity fragments, icon selection, completion replacement, Escape/reopen and delayed completion without stealing deliberately moved focus. No production learner data or browser session is included. Full course-format, all-version and production coverage is not claimed.

For the synthetic regression harness, install the development dependency in tests/regent (`npm install --ignore-scripts`) and run `node tests/regent/modal-regression.cjs /absolute/path/to/moodle` from this repository. The Moodle source supplies its shipped jQuery. Node 22.13.0 was the qualification build runtime. Do not run these development steps on production.

Upstream duplicate review remains incomplete. No Bitbucket PR is claimed; this authorized Regent branch is independent of upstream submission.
