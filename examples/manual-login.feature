Feature: Login

  Scenario: TC-001 Login with valid credentials
    Given the user is on the login page
    When the user enters a valid username and password
    And the user clicks the "Login" button
    Then the dashboard is displayed

  Scenario: TC-002 Login with a wrong password
    Given the user is on the login page
    When the user enters a wrong password
    Then the error "Invalid credentials" is shown

  Scenario: TC-003 Forgot password link
    Given the user is on the login page
    When the user clicks "Forgot password?"
    Then the reset password page is displayed
