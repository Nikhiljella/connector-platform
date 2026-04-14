package com.cdx.git;

import com.cdx.git.model.CDXGitException;
import com.cdx.git.model.CDXGitException.GitOperation;
import com.cdx.git.model.ContentFormat;
import com.cdx.git.model.GitPushResult;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.revwalk.RevTree;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;

/**
 * Core CDX Git utility component.
 *
 * <p>Provides two operations:
 * <ol>
 *   <li>{@link #pushFile} — stage, commit, and push a single file to the remote</li>
 *   <li>{@link #fetchModuleContent} — recursively read all files under a module path at a given ref</li>
 * </ol>
 *
 * <p>All Git operations are performed via JGit. {@code Runtime.exec()} and shell commands
 * are never used.
 */
@Slf4j
@Component
public class CDXGitUtil {

    private final String repoPath;
    private final String remote;
    private final String branch;
    private final String authorName;
    private final String authorEmail;
    private final CredentialsProvider gitCredentialsProvider;

    public CDXGitUtil(
            @Value("${cdx.git.repo-path}") String repoPath,
            @Value("${cdx.git.remote}") String remote,
            @Value("${cdx.git.branch}") String branch,
            @Value("${cdx.git.author-name}") String authorName,
            @Value("${cdx.git.author-email}") String authorEmail,
            CredentialsProvider gitCredentialsProvider) {
        this.repoPath = repoPath;
        this.remote = remote;
        this.branch = branch;
        this.authorName = authorName;
        this.authorEmail = authorEmail;
        this.gitCredentialsProvider = gitCredentialsProvider;
    }

    /**
     * Stages, commits, and pushes a single file to the configured remote branch.
     *
     * @param folderPath    path of the folder containing the file, relative to the repo root
     *                      (e.g. {@code "src/main/resources"})
     * @param fileName      name of the file to push (e.g. {@code "config.yml"})
     * @param commitMessage commit message to use
     * @return {@link GitPushResult} with {@code status="SUCCESS"} and the commit SHA on success,
     *         or {@code status="FAILURE"} with an error description on failure
     */
    public GitPushResult pushFile(String folderPath, String fileName, String commitMessage) {
        String relativePath = folderPath + "/" + fileName;
        log.info("pushFile — staging '{}' for commit on branch '{}'", relativePath, branch);

        try (Git git = openRepo()) {
            // Stage the file
            git.add().addFilepattern(relativePath).call();

            // Abort early if nothing was actually staged
            Status status = git.status().call();
            boolean hasStagedChanges = !status.getAdded().isEmpty()
                    || !status.getChanged().isEmpty()
                    || !status.getRemoved().isEmpty();

            if (!hasStagedChanges) {
                log.warn("pushFile — no staged changes found for: {}", relativePath);
                return GitPushResult.builder()
                        .status("FAILURE")
                        .branch(branch)
                        .message("No changes to commit for: " + relativePath)
                        .timestamp(Instant.now())
                        .build();
            }

            // Commit
            PersonIdent author = new PersonIdent(authorName, authorEmail);
            RevCommit commit = git.commit()
                    .setAuthor(author)
                    .setCommitter(author)
                    .setMessage(commitMessage)
                    .call();
            String commitSha = commit.getName();
            log.info("pushFile — committed {} ({})", commitSha, commitMessage);

            // Push
            Iterable<PushResult> pushResults = git.push()
                    .setCredentialsProvider(gitCredentialsProvider)
                    .setRemote(remote)
                    .setRefSpecs(new org.eclipse.jgit.transport.RefSpec("refs/heads/" + branch))
                    .call();

            // Inspect remote ref update status
            for (PushResult pr : pushResults) {
                Collection<RemoteRefUpdate> updates = pr.getRemoteUpdates();
                for (RemoteRefUpdate update : updates) {
                    RemoteRefUpdate.Status refStatus = update.getStatus();
                    if (refStatus == RemoteRefUpdate.Status.OK
                            || refStatus == RemoteRefUpdate.Status.UP_TO_DATE) {
                        log.info("pushFile — push succeeded: {}", refStatus);
                        return GitPushResult.builder()
                                .status("SUCCESS")
                                .commitSha(commitSha)
                                .branch(branch)
                                .message("Push successful: " + refStatus)
                                .timestamp(Instant.now())
                                .build();
                    } else {
                        String msg = "Remote rejected push — status: " + refStatus
                                + (update.getMessage() != null ? ", message: " + update.getMessage() : "");
                        log.error("pushFile — {}", msg);
                        return GitPushResult.builder()
                                .status("FAILURE")
                                .commitSha(commitSha)
                                .branch(branch)
                                .message(msg)
                                .timestamp(Instant.now())
                                .build();
                    }
                }
            }

            // No remote updates reported — treat as success (empty push result is unusual but not an error)
            log.warn("pushFile — push returned no remote ref updates");
            return GitPushResult.builder()
                    .status("SUCCESS")
                    .commitSha(commitSha)
                    .branch(branch)
                    .message("Push completed (no remote ref update reported)")
                    .timestamp(Instant.now())
                    .build();

        } catch (CDXGitException e) {
            throw e;
        } catch (Exception e) {
            log.error("pushFile — unexpected error pushing '{}': {}", relativePath, e.getMessage(), e);
            throw new CDXGitException("Failed to push file '" + relativePath + "': " + e.getMessage(), e, GitOperation.PUSH);
        }
    }

    /**
     * Recursively reads all files under {@code modulePath} at the given Git ref and
     * returns their aggregated content.
     *
     * <p>If {@code ref} is {@code null} or blank, {@code HEAD} is used.
     * If no files are found under {@code modulePath}, an empty result is returned without error.
     *
     * @param modulePath path prefix to filter within the repo tree (e.g. {@code "src/modules/payments"})
     * @param ref        branch name, tag, or full commit SHA; pass {@code null} for {@code HEAD}
     * @param format     desired output format — {@link ContentFormat#BYTES} or {@link ContentFormat#STRING}
     * @return {@code byte[]} when {@code format == BYTES}; {@code String} when {@code format == STRING}
     */
    public Object fetchModuleContent(String modulePath, String ref, ContentFormat format) {
        String resolvedRef = (ref == null || ref.isBlank()) ? "HEAD" : ref;
        log.info("fetchModuleContent — path='{}', ref='{}', format={}", modulePath, resolvedRef, format);

        try (Git git = openRepo()) {
            Repository repo = git.getRepository();

            ObjectId objectId = repo.resolve(resolvedRef);
            if (objectId == null) {
                throw new CDXGitException(
                        "Cannot resolve ref '" + resolvedRef + "' in repo: " + repoPath,
                        GitOperation.FETCH);
            }

            try (RevWalk revWalk = new RevWalk(repo)) {
                RevCommit commit = revWalk.parseCommit(objectId);
                RevTree tree = commit.getTree();

                ByteArrayOutputStream byteAccumulator = new ByteArrayOutputStream();
                StringBuilder stringAccumulator = new StringBuilder();

                try (TreeWalk treeWalk = new TreeWalk(repo)) {
                    treeWalk.addTree(tree);
                    treeWalk.setRecursive(true);

                    while (treeWalk.next()) {
                        String filePath = treeWalk.getPathString();
                        if (!filePath.startsWith(modulePath)) {
                            continue;
                        }

                        byte[] fileBytes = repo.open(treeWalk.getObjectId(0)).getBytes();
                        log.debug("fetchModuleContent — reading file: {}", filePath);

                        if (format == ContentFormat.BYTES) {
                            byteAccumulator.write(fileBytes);
                        } else {
                            stringAccumulator
                                    .append("// ===== FILE: ").append(filePath).append(" =====\n")
                                    .append(new String(fileBytes, StandardCharsets.UTF_8))
                                    .append("\n");
                        }
                    }
                }

                if (format == ContentFormat.BYTES) {
                    return byteAccumulator.toByteArray();
                } else {
                    return stringAccumulator.toString();
                }
            }

        } catch (CDXGitException e) {
            throw e;
        } catch (IOException e) {
            log.error("fetchModuleContent — IO error reading '{}' at ref '{}': {}", modulePath, resolvedRef, e.getMessage(), e);
            throw new CDXGitException(
                    "IO error reading module '" + modulePath + "' at ref '" + resolvedRef + "': " + e.getMessage(),
                    e, GitOperation.FETCH);
        } catch (Exception e) {
            log.error("fetchModuleContent — unexpected error: {}", e.getMessage(), e);
            throw new CDXGitException(
                    "Failed to fetch module content '" + modulePath + "': " + e.getMessage(),
                    e, GitOperation.FETCH);
        }
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /**
     * Opens the local Git repository at {@code repoPath}.
     *
     * @return a JGit {@link Git} instance (caller must close it)
     * @throws CDXGitException if the path does not exist or is not a Git repository
     */
    private Git openRepo() {
        File repoDir = new File(repoPath);
        if (!repoDir.exists() || !repoDir.isDirectory()) {
            throw new CDXGitException(
                    "Repo path does not exist or is not a directory: " + repoPath,
                    GitOperation.INIT);
        }
        try {
            return Git.open(repoDir);
        } catch (IOException e) {
            log.error("openRepo — cannot open Git repo at '{}': {}", repoPath, e.getMessage(), e);
            throw new CDXGitException(
                    "Cannot open Git repository at '" + repoPath + "': " + e.getMessage(),
                    e, GitOperation.INIT);
        }
    }
}
