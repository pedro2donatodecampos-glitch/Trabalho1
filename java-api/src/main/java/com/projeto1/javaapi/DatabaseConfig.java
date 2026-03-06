package com.projeto1.javaapi;

public class DatabaseConfig {
    private final String host;
    private final String port;
    private final String database;
    private final String user;
    private final String password;

    public DatabaseConfig() {
        this.host = env("DB_HOST", "localhost");
        this.port = env("DB_PORT", "3306");
        this.database = env("DB_NAME", "restaurante_db");
        this.user = env("DB_USER", "root");
        this.password = env("DB_PASSWORD", "");
    }

    public String jdbcUrl() {
        return String.format(
            "jdbc:mysql://%s:%s/%s?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
            host,
            port,
            database
        );
    }

    public String user() {
        return user;
    }

    public String password() {
        return password;
    }

    private String env(String key, String fallback) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        return value;
    }
}
