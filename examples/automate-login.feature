Feature: Login

  @smoke
  Scenario: TC-001 Login with valid credentials
    Given the user is on the login page
    When the user enters username "qa_user" and password "Secret123"
    And the user clicks the "Login" button
    Then the dashboard is displayed
    And the welcome message contains "qa_user"

  Scenario: TC-002 Login with a wrong password
    Given the user is on the login page
    When the user enters username "qa_user" and password "wrong"
    Then the error "Invalid credentials" is shown
