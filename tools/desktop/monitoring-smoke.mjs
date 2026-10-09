// Safety interlock before imports, process creation or any hardware call.
throw new Error(
  'Live monitoring testing is quarantined after three system freezes. Use test:monitoring:safe for hardware-free tests.',
);
