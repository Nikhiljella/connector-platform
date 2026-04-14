package com.cdx.git.model;

/**
 * Specifies the desired output format when fetching module content from the Git repository.
 */
public enum ContentFormat {
    /** Return aggregated file content as a raw byte array. */
    BYTES,

    /** Return aggregated file content as a UTF-8 decoded String, with per-file headers. */
    STRING
}
