package com.cdx.git.model;

/**
 * Unchecked exception thrown by CDX Git utility operations.
 * Carries a {@link GitOperation} tag so callers can distinguish push, fetch, and init failures.
 */
public class CDXGitException extends RuntimeException {

    /**
     * Git operations that can produce this exception.
     */
    public enum GitOperation {
        PUSH,
        FETCH,
        INIT
    }

    private final GitOperation operation;

    /**
     * @param message   human-readable error description
     * @param operation the Git operation that failed
     */
    public CDXGitException(String message, GitOperation operation) {
        super(message);
        this.operation = operation;
    }

    /**
     * @param message   human-readable error description
     * @param cause     underlying exception
     * @param operation the Git operation that failed
     */
    public CDXGitException(String message, Throwable cause, GitOperation operation) {
        super(message, cause);
        this.operation = operation;
    }

    /**
     * @return the Git operation that triggered this exception
     */
    public GitOperation getOperation() {
        return operation;
    }
}
