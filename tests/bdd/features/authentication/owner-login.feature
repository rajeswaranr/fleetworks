@authentication @owner @smoke @contract @mocked-auth
Feature: Owner authentication
  A registered fleet owner must be able to establish an authenticated session
  without loading fleet business data as part of the login operation.

  Scenario: Registered owner establishes a session with valid credentials
    Given an isolated registered owner test account
    And the authentication service is replaced by an approved test response
    When the owner submits valid test credentials
    Then an authenticated owner session should be stored
    And owner fleet data should not be pulled by the login operation
    And no authentication error should be returned
