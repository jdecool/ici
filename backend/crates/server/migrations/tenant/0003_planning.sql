CREATE TABLE planning_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    work_days integer[] NOT NULL DEFAULT '{0,1,2,3,4}'
        CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[0,1,2,3,4,5,6])
);
INSERT INTO planning_settings DEFAULT VALUES;
CREATE TABLE presence_entries (
    user_id uuid NOT NULL REFERENCES users(id),
    date date NOT NULL,
    half text NOT NULL CHECK (half IN ('am','pm')),
    status text NOT NULL CHECK (status IN ('office','remote','travel','off')),
    location_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
    note text NOT NULL DEFAULT '' CHECK (length(note)<=500),
    PRIMARY KEY (user_id,date,half),
    CHECK ((status='office') = (location_id IS NOT NULL))
);
CREATE INDEX presence_week ON presence_entries(date);
CREATE TABLE presence_templates (
    user_id uuid NOT NULL REFERENCES users(id),
    weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    half text NOT NULL CHECK (half IN ('am','pm')),
    status text NOT NULL CHECK (status IN ('office','remote','travel','off')),
    location_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id,weekday,half),
    CHECK ((status='office') = (location_id IS NOT NULL))
);
