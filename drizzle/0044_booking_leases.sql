CREATE TABLE "booking_leases" (
	"key" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
