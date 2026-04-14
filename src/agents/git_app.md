# CDX Git Utility — Claude Code Build Spec

## Overview

Build a production-ready Java utility for the **CDX (Client Data Exchange)** platform that provides:
1. **Selective file push** — stage, commit, and push a specific file from a specific folder to a remote Git repo
2. **Module content fetch** — recursively read all files in a CDX module directory and return content as `byte[]` or `String`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Java 17 |
| Framework | Spring Boot 3.x |
| Git Library | Eclipse JGit (`org.eclipse.jgit`) |
| Secrets | AWS Secrets Manager (via Spring Cloud AWS) |
| Logging | SLF4J + Lombok `@Slf4j` |
| Build Tool | Maven |

> **Do NOT use `Runtime.exec()` or shell commands. All Git operations must use JGit APIs only.**

---

## Maven Dependencies to Add

Add the following to `pom.xml`:

```xml
<!-- JGit -->
<dependency>
    <groupId>org.eclipse.jgit</groupId>
    <artifactId>org.eclipse.jgit</artifactId>
    <version>6.7.0.202309050840-r</version>
</dependency>

<!-- Spring Cloud AWS Secrets Manager -->
<dependency>
    <groupId>io.awspring.cloud</groupId>
    <artifactId>spring-cloud-aws-starter-secrets-manager</artifactId>
    <version>3.1.0</version>
</dependency>
```

---

## Application Properties

Add the following to `application.yml`:

```yaml
cdx:
  git:
    repo-path: /opt/cdx/repo          # Absolute path to the local cloned repo
    remote: origin
    branch: main
    author-name: CDX Platform
    author-email: cdx-platform@internal.com
    secret-name: cdx/git/credentials   # AWS Secrets Manager secret name
```

---

## File Structure to Create

```
src/main/java/com/cdx/git/
├── CDXGitUtil.java                  # Core utility bean
├── model/
│   ├── GitPushResult.java           # Push response model
│   ├── ContentFormat.java           # Enum: BYTES | STRING
│   └── CDXGitException.java         # Custom runtime exception
├── config/
│   └── GitCredentialsConfig.java    # Credentials bean wired from AWS Secrets Manager
```

---

## Class Specifications

### 1. `ContentFormat.java`

```java
public enum ContentFormat {
    BYTES,
    STRING
}
```

---

### 2. `CDXGitException.java`

Custom unchecked exception:
- Extends `RuntimeException`
- Constructors: `(String message)` and `(String message, Throwable cause)`
- Include a `GitOperation` enum field: `PUSH`, `FETCH`, `INIT`

---

### 3. `GitPushResult.java`

Fields:
- `String status` — `"SUCCESS"` or `"FAILURE"`
- `String commitSha` — the SHA of the created commit (null on failure)
- `String branch` — the target remote branch
- `String message` — human-readable result or error message
- `Instant timestamp`

Use Lombok: `@Data @Builder @NoArgsConstructor @AllArgsConstructor`

---

### 4. `GitCredentialsConfig.java`

- Annotate with `@Configuration`
- Inject the secret name via `@Value("${cdx.git.secret-name}")`
- Fetch the secret from AWS Secrets Manager — the secret should be a JSON object:
  ```json
  { "username": "git-user", "password": "ghp_token_or_pat" }
  ```
- Parse the JSON and expose a `@Bean` of type `org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider`
- Name the bean `gitCredentialsProvider`

---

### 5. `CDXGitUtil.java` — Core Utility

Annotate with `@Component` and `@Slf4j`.

Inject via constructor:
- `@Value("${cdx.git.repo-path}") String repoPath`
- `@Value("${cdx.git.remote}") String remote`
- `@Value("${cdx.git.branch}") String branch`
- `@Value("${cdx.git.author-name}") String authorName`
- `@Value("${cdx.git.author-email}") String authorEmail`
- `CredentialsProvider gitCredentialsProvider`

#### Method 1: `pushFile`

```java
public GitPushResult pushFile(String folderPath, String fileName, String commitMessage)
```

**Steps:**
1. Open the repo using `Git.open(new File(repoPath))`
2. Construct the relative file path: `folderPath + "/" + fileName`
3. Stage the file using `git.add().addFilepattern(relativePath).call()`
4. Check if there are any staged changes — if nothing is staged, return a `FAILURE` result with message `"No changes to commit for: <path>"`
5. Commit using `git.commit()` with configured author name, email, and the provided `commitMessage`
6. Push using `git.push()` with `gitCredentialsProvider`, remote, and `refs/heads/<branch>`
7. Capture the push result and extract the remote ref update status
8. Return a `GitPushResult` with status `SUCCESS` and the commit SHA on success, or `FAILURE` with error details on any exception
9. Wrap all JGit exceptions in `CDXGitException` and log with `log.error`

---

#### Method 2: `fetchModuleContent`

```java
public Object fetchModuleContent(String modulePath, String ref, ContentFormat format)
```

Return type: `byte[]` when `format == BYTES`, `String` (UTF-8) when `format == STRING`.

**Steps:**
1. Open the repo using `Git.open(new File(repoPath))`
2. Resolve the ref (branch name or commit SHA) using `repo.resolve(ref)` — default to `HEAD` if ref is null or blank
3. Use a `RevWalk` and `TreeWalk` to traverse the tree at that ref
4. Filter entries where the path starts with `modulePath`
5. For each matching file entry, use `repo.open(objectId).getBytes()` to read content
6. Aggregate all file contents:
   - For `BYTES`: concatenate all byte arrays
   - For `STRING`: decode each file as UTF-8, separate files with a header comment:
     ```
     // ===== FILE: <filePath> =====
     ```
7. Return the aggregated result
8. Wrap all exceptions in `CDXGitException(message, cause, GitOperation.FETCH)` and log with `log.error`

---

## Unit Tests to Generate

Create `CDXGitUtilTest.java` using JUnit 5 + Mockito:

| Test | Description |
|---|---|
| `pushFile_success` | Verify `GitPushResult.status == SUCCESS` and commitSha is populated |
| `pushFile_noChanges` | Verify FAILURE result when no diff is staged |
| `pushFile_credentialFailure` | Verify `CDXGitException` is thrown on auth error |
| `fetchModuleContent_asString` | Verify returned string contains file header comments |
| `fetchModuleContent_asBytes` | Verify returned byte array is non-empty |
| `fetchModuleContent_invalidRef` | Verify `CDXGitException` is thrown for bad ref |

---

## Error Handling Rules

- Never swallow exceptions silently — always log + wrap in `CDXGitException`
- If the repo path does not exist or is not a Git repo, throw `CDXGitException` with `GitOperation.INIT`
- If `modulePath` resolves to zero files, return empty `byte[0]` or empty `String` — do not throw
- Push failures due to remote rejection must be captured from `RemoteRefUpdate.Status` and surfaced in `GitPushResult.message`

---

## Notes for Claude Code

- All classes must be in the package `com.cdx.git` (or subpackages as defined above)
- Follow existing CDX conventions: constructor injection, no field injection except `@Value`
- Do not add any REST controllers — this is a utility bean to be injected into service classes
- Ensure the `GitCredentialsConfig` gracefully fails at startup with a clear error if the AWS secret is unreachable
- Add Javadoc to all public methods

---

*Spec version: 1.0 | Platform: CDX | Author: Nikhil | Target: Claude Code*