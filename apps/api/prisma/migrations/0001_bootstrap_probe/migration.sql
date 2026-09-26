CREATE TABLE "bootstrap_probes" (
    "id" UUID NOT NULL,
    "value" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_probes_value_length"
        CHECK (char_length("value") BETWEEN 1 AND 128),
    CONSTRAINT "bootstrap_probes_pkey" PRIMARY KEY ("id")
);
