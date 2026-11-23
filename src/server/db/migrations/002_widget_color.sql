-- Color of the widget (tab, buttons, focus) in each application. Default: the teal of Shifti / Flowi.
ALTER TABLE apps ADD COLUMN widget_color TEXT NOT NULL DEFAULT '#318f9b';
