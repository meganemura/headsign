# Lessons from workflows and skill migrations

headsign's earlier runtime executed checks, held state, and prompted agents to
continue. These lessons explain what remains useful when an ordinary skill
gives the model the objective, constraints, and available checks.
The linked ADRs preserve the original observations and design arguments.
Their runtime contracts are historical under
[ADR-0044](adr/0044-skills-only-distribution.md).

## A check's evidence depends on what it reads

A test executes behavior against an assertion. A command that reads an
`APPROVED` file reads its author's judgment. Both return exit codes, but
they support different claims. Deterministic execution does not make an
authored judgment independent.

Tests and their assertions can also change. A successful exit records the
result of those checks; it does not establish that the checks still express
the required property. Preserve that property when repairing a test.

[ADR-0007](adr/0007-verdict-authorship.md) identified who wrote the verdict
as the relevant boundary. Asking a reviewer, transcribing its response, and
letting it write its own response give the worker different opportunities
to change that evidence. A format check cannot establish review quality.

For a local skill, name the property being checked and the source of its
evidence. If independent review is required, preserve that independent author.
The worker can also inspect its whole diff critically. These checks answer
different questions and can both be useful.

Migration reviews found skills that narrowed when existing checks were required.
The commands stayed intact, but some work escaped its former checks.
The revisions restored that scope. The authoring guidance now asks agents to
compare which work requires each check before and after migration.
Preserve a check's applicability along with its command and purpose;
changing the method must preserve required outcomes.

## Evidence needs an artifact and a scope

A diff check depends on its base. A review depends on the revision it read.
A correct result against the wrong base can miss the work under review.
[ADR-0020](adr/0020-writing-the-workflow-as-its-own-skill.md) calls this
an anchored check: the check measures facts relative to supplied context.

Make the context explicit where it affects the conclusion.
Check that the intended revision, base, and task match.
Include new files in the artifact under review. A diff of tracked files can
omit a new test or implementation that will enter the eventual commit.
After editing the artifact, identify which conclusions need fresh evidence.
Clearing a verdict protects freshness; it does not establish the honesty or
competence of the next author.

A retained checker in one migration inspected committed changes. New,
uncommitted work could leave it with zero inputs and a successful exit.
The revised skill identified that gap and required direct review of the
unexamined work. Preserve the intended input scope when choosing evidence.

A migration helper passed isolated tests but failed when the new skill and
helper were included as inspected files. The complete-artifact trial exposed
a self-match in the checker's own pattern definition. Earlier fixtures executed
the helper from outside the inspected checkout.

The repair limited the exception to the checker's own rule definition.
The actual-artifact trial then passed before and after staging.
Forbidden references in ordinary text and added helper comments still failed.
Binary contents required separate review.
Verify revised artifacts within their actual input scope.
We retained the existing guidance and corrected the trial.

[ADR-0023](adr/0023-pinning-the-graph-a-run-is-walking-under.md) made changes
to active rules visible. Its durable lesson is to explain a changed check
and preserve the outcome it protects. A new flag or fingerprint cannot grant
authority to change that outcome.

## Checks also depend on how their evidence is maintained

A workflow can prepare a check's inputs or update a baseline after completion.
Copying the check command alone can lose those responsibilities.
For example, leaving a resolved mutation in an allowed baseline can permit
the same defect to return during later work.

During migration, identify who supplies the inputs, what changes invalidate
them, and which updates preserve the required property for later tasks.
Verify that the replacement supports those obligations.
Keep the review's subject explicit too: reviewing implementation does not
replace required review of proposed priorities or acceptance criteria.
The model can own these responsibilities without recreating phase transitions.

A migration trial restarted a counter while earlier review records remained.
The checker then accepted an earlier review as evidence for new work.
The repair gave each evaluation a fresh review location and an explicit input
that selected it. A subsequent evaluation required new evidence in the fixture.
An initial repair also rejected newly staged reviews; removing that condition
preserved valid evidence across staging. Git tracking status did not establish age.
Test later work with earlier records present, and preserve valid uses when
repairing a check. These trials checked evidence selection, not review quality.

A later migration review caught a missing client setting for a local test service.
Starting the service did not configure the application to use it.
The revised skill named both prerequisites and protected existing local data
when the checks needed fresh inputs. A scenario reader identified unsafe
preparation as a reason to report the check unrun. This was an instruction
trial; it did not establish that the application's acceptance tests passed.

## A local skill's path can also be a package input

During the archstrict migration, a new contributor skill went under `.agents/skills/`.
The npm manifest included `.agents/` as a whole, which also contains product assets.
Independent review caught the unintended distribution of contributor guidance.
The migration narrowed the package entries to the product's manifest, hooks, and MCP files.
A local package dry run checked the revised contents.

Inspect ignore rules and package inputs when choosing a local skill's location.
Preserve the intended audience of the instructions and any product assets that
share their parent directory. A discoverable local path can have distribution
effects beyond the agent session. This observation concerns packaging, not
whether the new skill improves product work.

## Helpers can protect the contents of a handoff

During a migration, independent review found two omitted obligations from an
old helper: a restriction on public commit content and a completion report.
The first skill preserved tests and independent review but missed these obligations.
The revision restored both. A separate scenario also exposed unclear work
selection; local guidance then identified the existing queue and selection rules.

Inspect what each helper protects, including publication and handoff constraints.
Keep local-only command details within their intended audience and make that
guidance discoverable. Authorization to execute an action remains a separate question.
These observations came from migration review and a scenario, not completed product work.

Another migration retained an old definition because the product consumed it
as historical input. New contributor guidance replaced its operational role.
An old introductory comment still described it as the current development
method; clarifying that comment preserved the input while removing conflicting guidance.
Inspect each caller's purpose before deleting an artifact that served the runtime.

## A command failure and an unavailable check need different repairs

[ADR-0021](adr/0021-a-command-that-never-ran-is-not-an-answer.md) separated
a negative result from a command that could not execute.
The first can identify a product defect. The second leaves the required
property unverified and calls for a prerequisite or invocation repair.

A local skill should keep that distinction in its report.
Name what ran, what it checked, and what prevented an answer.
Do not convert missing dependencies into a successful gate.
A timeout reports an execution limit; diagnosing its cause still needs evidence.
Retrying unchanged prerequisites spends effort without resolving the missing
result.

## Completion is a claim about the requested work

Passing one command supplies evidence for what that command checks.
Reaching the end of a procedure does not establish every requirement.
Completion needs the requested result and current evidence for its applicable
conditions, including CI or independent review when the project requires them.

[ADR-0038](adr/0038-a-run-assesses-its-procedure.md) explicitly treated a
completed run as historical. Later improvements to its artifact required
verification again. Keep that rule for skills: apply a repair to the present
work, then check the conclusions it affects.

Authoring and execution also have different scopes.
[ADR-0020](adr/0020-writing-the-workflow-as-its-own-skill.md) separated
writing a workflow from starting its work.
The current boundary follows the user's request: a request can authorize
both creating a skill and using it.

## Budgets and useful work count different things

[ADR-0017](adr/0017-three-budgets-and-the-recoverable-ceiling.md) distinguished
failed checks, successful work items, and total iterations.
A long queue can consume many successful iterations.
A repeated failed check can spend attempts on one unresolved item.
Neither number alone states whether the method is effective.

Carry explicit user budgets into the skill with their actual scope.
Starting another task or assessment does not reset a budget that covers the
whole request. Use the remaining budget for improvement and honor a stop.
Preserve the work and reason for stopping so continuation can make use of them.

[ADR-0024](adr/0024-the-log-survives-a-restart.md) retained history when
starting again. Its useful principle is continuity of evidence; ordinary
project records can provide it without a new headsign log format.

## Ownership and a queue answer separate questions

A queue identifies work that remains. Ownership identifies who may change a
particular task or working tree. The runtime's ownership changes in
[ADR-0008](adr/0008-multi-session-ownership.md) and
[ADR-0027](adr/0027-recording-who-drove-a-run.md) responded to multiple
sessions affecting the same run.

A local skill should use the project's existing coordination when needed.
A queue entry does not establish exclusive ownership. An old owner record
does not establish that a session is still active.
Inspect current work before taking over.
For a single authorized task, the request and working context can suffice.
Do not create a queue or ownership protocol solely to imitate the old engine.

A migration review found that an evidence helper replaced a shared output
directory. The repair required a new location for each review. A safe refusal
test preserved an existing file and stopped before browser launch.
Image generation remained unverified. Existing ownership guidance covered this
repair; the observation did not require another coordination mechanism.

## Improvement belongs inside the current task

The feedback behind [ADR-0043](adr/0043-local-skills-improve-during-work.md)
described repeated review findings after local checks passed.
Repairing each cited line left the method that missed those issues unchanged.
Waiting until completion delayed the improvement that the current work needed.

When feedback exposes a weakness, assess its cause and choose a consequential
repair. For example, inspect the whole diff for related mistakes before
resubmitting an isolated fix. Add or improve a check when it can test the
required property. Preserve independent review where the project requires it.

Apply the repair, finish the current work, and verify affected results.
Retain useful knowledge in a skill, check, or project document.
Keeping the existing method can be justified; an edit count or assessment
record does not establish improvement.
Assess again at completion without starting recursive improvement work.

## Model judgment and instrumentation have different jobs

The old CLI could measure an exit code and count calls.
Those observations did not decide whether a check covered the requirement or
whether changing the method would help.
[ADR-0039](adr/0039-design-for-the-model-that-improves-the-method.md)
assigns semantic judgment to the model and asks what better models let us remove.

The skills-only decision removes runtime responsibilities while retaining
outcomes, checks, and improvement as model responsibilities.
It assumes models will improve at using these inputs.
Present validation can inspect instructions and observe particular tasks;
it cannot establish that future models always choose correctly.

Evaluate the approach through actual outcomes: missed requirements, review
rounds, human intervention, and the cost of keeping instructions useful.
Use those observations to revise the method. Treat newly added procedure as
a cost that needs a purpose.
