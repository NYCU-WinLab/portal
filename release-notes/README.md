# Release notes

One file per pull request that changes something members see: `<branch>.md`, in Chinese, one change per line, written for members (what they can do now), not for developers. Internal changes (refactors, CI, dependencies) get no file.

The deploy publishes each new file once (`scripts/migrate.ts`), stamped with the deployed commit. Members see the notes in a dialog on their next visit after the deploy, and all of them on `/changelog`. Never rename or edit a published file: the slug is its id.
