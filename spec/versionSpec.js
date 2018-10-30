const Version = imports.version;

describe("Version", function() {
    it("returns a comparable id from major minor version", function() {
        expect(Version.getShellVersionId(3, 28)).toBeGreaterThan(
            Version.getShellVersionId(3, 26)
        );
        expect(Version.getShellVersionId(3, 28)).toBeGreaterThan(
            Version.getShellVersionId(2, 20)
        );
        expect(Version.getShellVersionId(3, 28)).toBeGreaterThan(
            Version.getShellVersionId(2, 48)
        );
    });
    it("returns a comparable id from string", function() {
        expect(Version.getShellVersionIdFromString("3.28")).toBeGreaterThan(
            Version.getShellVersionIdFromString("3.26")
        );
        expect(Version.getShellVersionIdFromString("3.28")).toBeGreaterThan(
            Version.getShellVersionIdFromString("2.20")
        );
        expect(Version.getShellVersionIdFromString("3.28")).toBeGreaterThan(
            Version.getShellVersionIdFromString("2.48")
        );
    });
    it("compares string and major minor", function() {
        expect(Version.getShellVersionIdFromString("3.28")).toBeGreaterThan(
            Version.getShellVersionId(3, 26)
        );
        expect(Version.getShellVersionId(3, 28)).toBeGreaterThan(
            Version.getShellVersionIdFromString("2.20")
        );
    });
});
