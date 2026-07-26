# FleetApp behavior specification

## Summary

This capability captures the core user-facing behavior expected in the FleetApp repository so future changes can be planned and reviewed with BDD-style acceptance criteria.

## Requirements

1. FleetApp must allow owners to manage vehicles, drivers, fuel, expenses, issues, and compliance reminders from a single operational view.
2. Driver and vehicle relationships must be visible across the app so assignments, compliance, and analytics all stay consistent.
3. Service workflow and garage operations must support tracking a repair request from creation through completion and feedback.
4. Payroll and payout setup must clearly show available drivers and their payout readiness for signed-in users.
5. Fleet analytics must reflect the selected vehicle or time window and present accurate cost, mileage, and compliance summaries.
6. The app should provide a helpful Copilot-style assistant experience when fleet data is available.

## Behavioral Scenarios

### Scenario: add and view a new vehicle
Given an owner is working in the FleetApp dashboard
When they add a new vehicle with registration, type, and monthly usage details
Then the vehicle appears in fleet views and can be used for compliance, issues, and analytics
And the new vehicle is immediately available to the rest of the workflow

### Scenario: assign a driver to a vehicle
Given a driver and a vehicle both exist in the system
When the owner assigns the driver to that vehicle
Then the driver is linked to the vehicle in the fleet data
And the assignment is reflected in driver-related screens and downstream analytics

### Scenario: surface compliance reminders for expiring documents
Given a vehicle has compliance documents such as insurance, permit, or fitness records
When one of those documents is nearing expiry or overdue
Then the reminder appears in the relevant compliance or action inbox view
And the owner can act on the reminder before it becomes a missed compliance event

### Scenario: raise and progress a service request
Given a vehicle requires maintenance or repair
When the owner raises a service request through the workflow flow
Then the request moves through the defined service stages
And the garage or mechanic view can track progress, invoice, and feedback status

### Scenario: manage payroll payout setup for a driver
Given a signed-in payroll user has drivers in the system
When payout details are added or reviewed for a driver
Then the driver is shown as ready or pending for payout setup
And payroll history and payout status remain visible in the payroll view

### Scenario: filter analytics by vehicle and time window
Given fleet spend and usage data exists for multiple vehicles
When the user selects a vehicle or time filter in analytics
Then the dashboard updates to show only the relevant costs, mileage, and compliance metrics
And the totals remain consistent with the selected scope

### Scenario: answer fleet questions with existing data
Given the user asks the Copilot assistant about vehicle, expense, maintenance, or compliance information
When the required data exists in the loaded fleet records
Then the assistant responds with relevant context from the current fleet data
And it avoids inventing results when the information is unavailable
