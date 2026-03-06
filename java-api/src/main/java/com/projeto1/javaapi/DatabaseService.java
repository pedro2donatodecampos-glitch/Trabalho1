package com.projeto1.javaapi;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class DatabaseService {
    private final DatabaseConfig config;

    public DatabaseService(DatabaseConfig config) {
        this.config = config;
    }

    public Connection openConnection() throws SQLException {
        return DriverManager.getConnection(config.jdbcUrl(), config.user(), config.password());
    }

    public boolean isConnected() {
        try (Connection ignored = openConnection()) {
            return true;
        } catch (SQLException ex) {
            return false;
        }
    }

    public String mysqlVersion() throws SQLException {
        String sql = "SELECT VERSION() as version";
        try (Connection conn = openConnection();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            if (rs.next()) {
                return rs.getString("version");
            }
            return "unknown";
        }
    }
}
