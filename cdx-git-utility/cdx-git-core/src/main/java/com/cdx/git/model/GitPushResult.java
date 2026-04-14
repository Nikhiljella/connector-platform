package com.cdx.git.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Result returned by {@code CDXGitUtil#pushFile} after a push attempt.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GitPushResult {

    /** {@code "SUCCESS"} or {@code "FAILURE"}. */
    private String status;

    /** SHA of the created commit; {@code null} on failure. */
    private String commitSha;

    /** Target remote branch name (e.g. {@code "main"}). */
    private String branch;

    /** Human-readable result description or error details. */
    private String message;

    /** Timestamp when the push operation completed. */
    private Instant timestamp;
}
