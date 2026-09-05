-- Add welcome_message template for AiSensy.
-- Campaign name in AiSensy dashboard must exactly match: welcome_message

insert into whatsapp_templates (name, category, language, body, variables, purpose, approved)
values (
  'welcome_message', 'utility', 'en',
  E'Namaste {{1}},\n\nYou are now connected to *{{2}}* on FleetWorks.\n\nWe will send your vehicle assignments, salary updates and important alerts here.\n\nReply STOP at any time to stop messages.',
  array['driver_name','fleet_name'],
  'Sent once when a driver is opted in, to introduce the channel.',
  true
)
on conflict (name) do nothing;
