package com.cdx.git;

import com.cdx.git.model.CDXGitException;
import com.cdx.git.model.CDXGitException.GitOperation;
import com.cdx.git.model.ContentFormat;
import com.cdx.git.model.GitPushResult;
import org.eclipse.jgit.api.*;
import org.eclipse.jgit.api.errors.TransportException;
import org.eclipse.jgit.lib.*;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link CDXGitUtil}.
 *
 * <p>Uses a real temporary Git repo (via JGit) so push/fetch logic can be exercised
 * without mocking the entire JGit fluent API chain.
 */
@ExtendWith(MockitoExtension.class)
class CDXGitUtilTest {

    @TempDir
    Path tempDir;

    @Mock
    private CredentialsProvider credentialsProvider;

    private org.eclipse.jgit.api.Git localRepo;
    private CDXGitUtil util;

    @BeforeEach
    void setUp() throws Exception {
        // Init a bare "remote" repo and a local clone pointing to it
        Path bareRemote = tempDir.resolve("remote.git");
        Files.createDirectories(bareRemote);
        org.eclipse.jgit.api.Git.init().setDirectory(bareRemote.toFile()).setBare(true).call().close();

        Path localPath = tempDir.resolve("local");
        Files.createDirectories(localPath);
        localRepo = org.eclipse.jgit.api.Git.cloneRepository()
                .setURI(bareRemote.toUri().toString())
                .setDirectory(localPath.toFile())
                .call();

        // Create an initial commit so HEAD exists
        Path readme = localPath.resolve("README.md");
        Files.writeString(readme, "init");
        localRepo.add().addFilepattern("README.md").call();
        localRepo.commit()
                .setAuthor("Test", "test@test.com")
                .setCommitter("Test", "test@test.com")
                .setMessage("initial commit")
                .call();
        localRepo.push().call();

        util = new CDXGitUtil(
                localPath.toString(),
                "origin",
                "master",
                "CDX Platform",
                "cdx@internal.com",
                credentialsProvider);
    }

    // -------------------------------------------------------------------------
    // pushFile tests
    // -------------------------------------------------------------------------

    @Test
    void pushFile_success() throws Exception {
        // Write a new file into the repo working directory
        Path folder = localRepo.getRepository().getWorkTree().toPath().resolve("src");
        Files.createDirectories(folder);
        Files.writeString(folder.resolve("data.json"), "{\"key\":\"value\"}");

        GitPushResult result = util.pushFile("src", "data.json", "add data.json");

        assertThat(result.getStatus()).isEqualTo("SUCCESS");
        assertThat(result.getCommitSha()).isNotBlank();
        assertThat(result.getBranch()).isEqualTo("master");
        assertThat(result.getTimestamp()).isNotNull();
    }

    @Test
    void pushFile_noChanges() {
        // Stage a file that doesn't exist / has no diff — nothing will be added
        GitPushResult result = util.pushFile("nonexistent", "ghost.txt", "empty commit");

        assertThat(result.getStatus()).isEqualTo("FAILURE");
        assertThat(result.getMessage()).contains("No changes to commit for:");
        assertThat(result.getCommitSha()).isNull();
    }

    @Test
    void pushFile_credentialFailure() throws Exception {
        // Write a file so staging succeeds, but make the push throw a transport error
        Path folder = localRepo.getRepository().getWorkTree().toPath().resolve("auth-test");
        Files.createDirectories(folder);
        Files.writeString(folder.resolve("secret.txt"), "data");

        // Use a util wired with a non-existent remote URL to force TransportException
        CDXGitUtil faultyUtil = new CDXGitUtil(
                localRepo.getRepository().getWorkTree().getAbsolutePath(),
                "bad-remote-that-does-not-exist",
                "master",
                "CDX Platform",
                "cdx@internal.com",
                credentialsProvider);

        assertThatThrownBy(() -> faultyUtil.pushFile("auth-test", "secret.txt", "auth failure test"))
                .isInstanceOf(CDXGitException.class)
                .satisfies(ex -> assertThat(((CDXGitException) ex).getOperation()).isEqualTo(GitOperation.PUSH));
    }

    // -------------------------------------------------------------------------
    // fetchModuleContent tests
    // -------------------------------------------------------------------------

    @Test
    void fetchModuleContent_asString() throws Exception {
        // Commit a file under modules/payments/ so it's in the tree
        Path modDir = localRepo.getRepository().getWorkTree().toPath().resolve("modules/payments");
        Files.createDirectories(modDir);
        Files.writeString(modDir.resolve("PaymentService.java"), "public class PaymentService {}");
        localRepo.add().addFilepattern("modules/").call();
        localRepo.commit()
                .setAuthor("CDX", "cdx@internal.com")
                .setCommitter("CDX", "cdx@internal.com")
                .setMessage("add payments module")
                .call();

        Object result = util.fetchModuleContent("modules/payments", "HEAD", ContentFormat.STRING);

        assertThat(result).isInstanceOf(String.class);
        String content = (String) result;
        assertThat(content).contains("// ===== FILE: modules/payments/PaymentService.java =====");
        assertThat(content).contains("PaymentService");
    }

    @Test
    void fetchModuleContent_asBytes() throws Exception {
        // Commit a file under modules/accounts/
        Path modDir = localRepo.getRepository().getWorkTree().toPath().resolve("modules/accounts");
        Files.createDirectories(modDir);
        Files.writeString(modDir.resolve("Account.java"), "public class Account {}");
        localRepo.add().addFilepattern("modules/").call();
        localRepo.commit()
                .setAuthor("CDX", "cdx@internal.com")
                .setCommitter("CDX", "cdx@internal.com")
                .setMessage("add accounts module")
                .call();

        Object result = util.fetchModuleContent("modules/accounts", "HEAD", ContentFormat.BYTES);

        assertThat(result).isInstanceOf(byte[].class);
        assertThat((byte[]) result).isNotEmpty();
    }

    @Test
    void fetchModuleContent_invalidRef() {
        assertThatThrownBy(() -> util.fetchModuleContent("modules/payments", "refs/heads/nonexistent-xyz-branch", ContentFormat.STRING))
                .isInstanceOf(CDXGitException.class)
                .satisfies(ex -> assertThat(((CDXGitException) ex).getOperation()).isEqualTo(GitOperation.FETCH));
    }
}
