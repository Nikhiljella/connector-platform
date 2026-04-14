# CDX Git Utility

A production-ready Spring Boot utility for the **CDX (Client Data Exchange)** platform that provides selective Git file push and recursive module content fetch — all via JGit (no shell commands).

---

## Features

### Selective File Push
- Stage, commit, and push a **single file** from a specific folder to a remote Git repo
- Configurable author name, email, remote, and branch
- Returns a structured `GitPushResult` — status, commit SHA, branch, message, and timestamp
- Detects when there are no changes to commit and returns a clean `FAILURE` result (no empty commits)
- Captures `RemoteRefUpdate.Status` for detailed push rejection messages

### Module Content Fetch
- Recursively reads **all files** under a given module path at any branch, tag, or commit SHA
- Returns content as:
  - `byte[]` — raw concatenated bytes (suitable for streaming or binary handling)
  - `String` — UTF-8 decoded, with per-file headers in the format `// ===== FILE: <path> =====`
- Defaults to `HEAD` when no ref is specified
- Returns empty result (not an exception) when the module path has no files

### AWS Secrets Manager Integration
- Git credentials (`username` / `password`) are fetched at startup from AWS Secrets Manager
- Secret must be a JSON object: `{ "username": "git-user", "password": "ghp_token" }`
- Fails fast at startup with a clear log message if the secret is unreachable or malformed

### Error Handling
- All exceptions are wrapped in `CDXGitException` with a `GitOperation` tag (`PUSH`, `FETCH`, `INIT`)
- Invalid repo path → `INIT` exception at call time
- Bad Git ref → `FETCH` exception
- Auth / transport failure → `PUSH` exception
- All errors are logged via SLF4J before being thrown

---

## Project Structure

```
cdx-git-utility/
├── pom.xml                          Parent POM (Java 17, multimodule)
├── cdx-git-core/                    Library module — utility logic
│   └── src/main/java/com/cdx/git/
│       ├── CDXGitUtil.java          Core utility bean
│       ├── config/
│       │   └── GitCredentialsConfig.java   AWS Secrets Manager credentials
│       └── model/
│           ├── ContentFormat.java   Enum: BYTES | STRING
│           ├── GitPushResult.java   Push operation result model
│           └── CDXGitException.java Custom exception with GitOperation tag
└── cdx-git-app/                     Runnable Spring Boot application
    └── src/main/
        ├── java/com/cdx/git/app/
        │   └── CDXGitApplication.java
        └── resources/
            └── application.yml
```

---

## Configuration

Edit `cdx-git-app/src/main/resources/application.yml`:

```yaml
cdx:
  git:
    repo-path: /opt/cdx/repo          # Absolute path to local cloned repo
    remote: origin
    branch: main
    author-name: CDX Platform
    author-email: cdx-platform@internal.com
    secret-name: cdx/git/credentials   # AWS Secrets Manager secret name

spring:
  cloud:
    aws:
      region:
        static: us-east-1
      credentials:
        instance-profile: true         # Uses IAM role on EC2/ECS
```

**AWS Secret format** (store at the path set in `secret-name`):
```json
{ "username": "git-user", "password": "ghp_your_personal_access_token" }
```

---

## How to Run

> **Prerequisite:** Java 17 must be available. Maven defaults to the system JDK — if yours is higher than 17, prefix commands with `JAVA_HOME=$(/usr/libexec/java_home -v 17)`.

### Build (skip tests)

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
  mvn clean package -DskipTests \
  -f cdx-git-utility/pom.xml
```

### Run tests

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
  mvn test -pl cdx-git-core \
  -f cdx-git-utility/pom.xml
```

### Start the application

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
  mvn spring-boot:run -pl cdx-git-app \
  -f cdx-git-utility/pom.xml
```

> The app will fail to start locally if AWS credentials / Secrets Manager are not configured. To test the utility logic in isolation, inject a mock `CredentialsProvider` in tests (see `CDXGitUtilTest`).

---

## Usage

Inject `CDXGitUtil` into any Spring service:

```java
@Service
@RequiredArgsConstructor
public class MyService {

    private final CDXGitUtil cdxGitUtil;

    public void syncConfig() {
        GitPushResult result = cdxGitUtil.pushFile(
            "config/payments",          // folder path (relative to repo root)
            "payments.yml",             // file name
            "chore: update payments config"
        );

        if ("SUCCESS".equals(result.getStatus())) {
            log.info("Pushed commit: {}", result.getCommitSha());
        }
    }

    public String readModule() {
        return (String) cdxGitUtil.fetchModuleContent(
            "src/modules/payments",     // module path prefix
            "main",                     // branch / tag / SHA (null = HEAD)
            ContentFormat.STRING
        );
    }
}
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Java 17 |
| Framework | Spring Boot 3.2 |
| Git Library | Eclipse JGit 6.7 |
| Secrets | AWS Secrets Manager (Spring Cloud AWS 3.1) |
| Logging | SLF4J + Lombok `@Slf4j` |
| Build | Maven (multimodule) |
| Tests | JUnit 5 + Mockito |
