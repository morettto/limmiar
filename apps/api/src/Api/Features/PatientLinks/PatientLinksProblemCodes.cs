namespace Api.PatientLinks;

public static class PatientLinksProblemCodes
{
    public const string LinkInviteNotFound = "link.invite_not_found";

    public const string LinkAlreadyLinked = "link.already_linked";

    public const string LinkNotFound = "link.not_found";

    // Same code for "not an active Professional" (create invite) and "not a Patient" (redeem) --
    // both are "this account cannot perform this side of the link", a caller cannot probe which.
    public const string LinkNotAuthorized = "link.not_authorized";

    public const string SharingPreferencesNotFound = "sharing.preferences_not_found";

    public const string SharingVersionConflict = "sharing.version_conflict";
}
