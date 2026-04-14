package com.cdx.git.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;
import software.amazon.awssdk.services.secretsmanager.model.SecretsManagerException;

/**
 * Spring configuration that fetches Git credentials from AWS Secrets Manager
 * and exposes them as a JGit {@link UsernamePasswordCredentialsProvider} bean.
 *
 * <p>The secret must be a JSON object with the shape:
 * <pre>{ "username": "git-user", "password": "ghp_token_or_pat" }</pre>
 *
 * <p>If the secret is unreachable at startup the application will fail fast
 * with a clear log message rather than surfacing a cryptic NullPointerException later.
 */
@Slf4j
@Configuration
public class GitCredentialsConfig {

    @Value("${cdx.git.secret-name}")
    private String secretName;

    /**
     * Resolves Git credentials from AWS Secrets Manager.
     *
     * @param secretsManagerClient auto-configured Spring Cloud AWS client
     * @return a JGit credentials provider ready for push/pull operations
     * @throws IllegalStateException if the secret cannot be fetched or parsed
     */
    @Bean(name = "gitCredentialsProvider")
    public UsernamePasswordCredentialsProvider gitCredentialsProvider(SecretsManagerClient secretsManagerClient) {
        log.info("Fetching Git credentials from AWS Secrets Manager — secret: {}", secretName);
        try {
            GetSecretValueRequest request = GetSecretValueRequest.builder()
                    .secretId(secretName)
                    .build();
            GetSecretValueResponse response = secretsManagerClient.getSecretValue(request);

            ObjectMapper mapper = new ObjectMapper();
            JsonNode json = mapper.readTree(response.secretString());

            String username = json.get("username").asText();
            String password = json.get("password").asText();

            log.info("Git credentials loaded successfully for user: {}", username);
            return new UsernamePasswordCredentialsProvider(username, password);

        } catch (SecretsManagerException e) {
            log.error("FATAL: Unable to reach AWS Secrets Manager for secret '{}'. " +
                      "Check IAM permissions and network connectivity. Error: {}", secretName, e.awsErrorDetails().errorMessage());
            throw new IllegalStateException("CDX Git startup failed — cannot load credentials from AWS Secrets Manager: " + secretName, e);
        } catch (Exception e) {
            log.error("FATAL: Failed to parse Git credentials secret '{}'. " +
                      "Ensure the secret is valid JSON with 'username' and 'password' fields.", secretName, e);
            throw new IllegalStateException("CDX Git startup failed — malformed credentials secret: " + secretName, e);
        }
    }
}
