# Legacy UI Shells

These files still own page bootstrapping, DOM rendering, and event binding for the current static UI.
Business workflows are delegated into `js/modules/*` first, with old inline behavior retained only as compatibility fallback.

Do not add new business logic here. Add it to the relevant module domain/use-case/adapter layer and call the module API from the shell.
