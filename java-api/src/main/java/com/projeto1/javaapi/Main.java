package com.projeto1.javaapi;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;

public class Main {
    public static void main(String[] args) throws IOException {
        DatabaseConfig config = new DatabaseConfig();
        DatabaseService dbService = new DatabaseService(config);

        int port = Integer.parseInt(System.getenv().getOrDefault("JAVA_API_PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        server.createContext("/health", exchange -> respondJson(exchange, 200, "{\"status\":\"ok\"}"));

        server.createContext("/db-status", exchange -> {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                respondJson(exchange, 405, "{\"error\":\"Método não permitido\"}");
                return;
            }

            try {
                String version = dbService.mysqlVersion();
                respondJson(exchange, 200, "{\"database\":\"connected\",\"version\":\"" + escapeJson(version) + "\"}");
            } catch (SQLException ex) {
                respondJson(exchange, 500, "{\"database\":\"disconnected\",\"error\":\"" + escapeJson(ex.getMessage()) + "\"}");
            }
        });

        server.setExecutor(null);
        server.start();

        System.out.println("Java API rodando em http://localhost:" + port);
        System.out.println("Health: http://localhost:" + port + "/health");
        System.out.println("DB: http://localhost:" + port + "/db-status");
    }

    private static void respondJson(HttpExchange exchange, int statusCode, String json) throws IOException {
        byte[] responseBytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(statusCode, responseBytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(responseBytes);
        }
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", " ")
            .replace("\r", " ");
    }
}
