### Behaviour changes

- **A bare `/report/` with several projects opens on the first project.** With more than one
  project and none named in the URL, the dashboard showed only a load error ("name a project")
  and no project picker. It now opens on the first project in `pxsig.workspace.json`'s
  `projects`, shows the picker, and names the project in the URL (`?project=<name>`), so a reload
  or a shared link keeps it. The server is unchanged: an API request with no project in a
  multi-project workspace is still refused, and every write still names its project.
  To update: nothing to do. To open on another project, list it first in `projects`, or link
  `?project=<name>`.
