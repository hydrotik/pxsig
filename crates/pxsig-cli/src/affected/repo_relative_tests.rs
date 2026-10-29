use super::paths::repo_relative;
use std::path::Path;

#[test]
fn changed_files_become_repo_relative() {
    assert_eq!(
        repo_relative(Path::new("/r/repo"), "src/a.tsx"),
        "src/a.tsx"
    );
    assert_eq!(
        repo_relative(Path::new("/r/repo"), "./src/a.tsx"),
        "src/a.tsx"
    );
    #[cfg(not(windows))]
    {
        assert_eq!(
            repo_relative(Path::new("/r/repo"), "/r/repo/src/a.tsx"),
            "src/a.tsx"
        );
        assert_eq!(
            repo_relative(Path::new("/r/repo/"), "/r/repo/src/a.tsx"),
            "src/a.tsx"
        );
        assert_eq!(
            repo_relative(Path::new("/r/repo"), "/elsewhere/a.tsx"),
            "/elsewhere/a.tsx"
        );
    }
    #[cfg(windows)]
    {
        assert_eq!(
            repo_relative(Path::new("C:\\Repo"), "c:\\repo\\src\\a.tsx"),
            "src/a.tsx"
        );
        assert_eq!(
            repo_relative(Path::new("C:\\Repo"), "src\\a.tsx"),
            "src/a.tsx"
        );
    }
}
