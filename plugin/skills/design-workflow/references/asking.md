# Asking well

Read this before you ask the user a design question. The entry skill states
the constraints; this file is the method.

Use the user's existing decisions and delegated authority. Ask when a missing
answer affects the required outcome or a constraint you cannot choose. Routine
design choices within that authority do not need another confirmation:

- **One question at a time.** A batch of questions gets a batch of shallow
  answers.
- **Before asking, try to answer it yourself, plainly.** Read the repository,
  read the run history if there is one, and write out what you think the
  answer is and what it costs. Most questions worth asking answer themselves
  on the way to being said plainly.
- **If the explanation produced the answer, do not ask.** The point of
  explaining first is to make the question unnecessary, not to preface it.
- **When you do ask, bring the candidates and what each one costs.** "How
  many attempts should implement get?" is work handed back to the user.
  "I put 5 here because implementation legitimately takes several passes;
  3 would surface a stuck loop sooner but ends the run earlier" is a
  question they can answer in one line.
- **Do not invent required authority.** Ask for a missing decision when it
  blocks the work. Continue independent work while you wait.
- **Keep the answers where they survive.** A decision that explains why the
  file has the shape it has belongs in the file's comments (see *What goes
  in the comments*); the rest belongs in what you report at the end. The
  conversation does not survive; the file does.

**When a required answer is unavailable, finish the independent work.**
Keep the dependent decision open. Report the missing answer, its effect, and
your recommendation with its reason. Mark any affected draft as unconfirmed.
Elapsed time does not supply authority; existing delegation can supply it.
