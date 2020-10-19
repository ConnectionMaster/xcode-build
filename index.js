// MIT License - Copyright (c) 2020 Stefan Arentz <stefan@devbots.xyz>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.


const path = require('path');
const fs = require('fs');

const core = require('@actions/core');
const artifact = require('@actions/artifact');
const execa = require('execa');

const { getOptionalInput, getOptionalBooleanInput, getOptionalYesNoInput } = require('@devbotsxyz/inputs');
const { parseDestination, encodeDestinationOption } = require('./destinations');


const buildProject = async ({workspace, project, scheme, configuration, sdk, arch, destination, disableCodeSigning, codeSignIdentity, codeSigningRequired, codeSignEntitlements, codeSigningAllowed, developmentTeam, clean, resultBundlePath}) => {
    let options = []
    if (workspace !== undefined) {
        options.push("-workspace", workspace);
    }
    if (project !== undefined) {
        options.push("-project", project);
    }
    if (scheme !== undefined) {
        options.push("-scheme", scheme);
    }
    if (configuration !== undefined) {
        options.push("-configuration", configuration);
    }
    if (destination !== undefined) {
        options.push("-destination", encodeDestinationOption(destination) );
    }
    if (sdk !== undefined) {
        options.push("-sdk", sdk);
    }
    if (arch !== undefined) {
        options.push("-arch", arch);
    }

    let buildOptions = []

    if (resultBundlePath !== undefined) {
        buildOptions = [...buildOptions, '-resultBundlePath', resultBundlePath];
    }

    let buildSettings = []
    
    if (disableCodeSigning === true) {
        buildSettings.push('CODE_SIGN_IDENTITY=""');
        buildSettings.push('CODE_SIGNING_REQUIRED="NO"');
        buildSettings.push('CODE_SIGN_ENTITLEMENTS=""');
        buildSettings.push('CODE_SIGNING_ALLOWED="NO"');
    } else {
        if (codeSignIdentity !== undefined) {
            buildSettings.push(`CODE_SIGN_IDENTITY=${codeSignIdentity}`);
        }
        if (codeSigningRequired !== undefined) {
            buildSettings.push(`CODE_SIGNING_REQUIRED=${codeSigningRequired ? 'YES' : 'NO'}`);
        }
        if (codeSignEntitlements !== undefined) {
            buildSettings.push(`CODE_SIGN_ENTITLEMENTS=${codeSignEntitlements}`);
        }
        if (codeSigningAllowed !== undefined) {
            buildSettings.push(`CODE_SIGNING_ALLOWED=${codeSigningAllowed ? 'YES' : 'NO'}`);
        }
    }

    if (developmentTeam !== undefined) {
        buildSettings.push(`DEVELOPMENT_TEAM=${developmentTeam}`);
    }

    let command = ['build']
    if (clean === true) {
        command = ['clean', ...command]
    }

    console.log("EXECUTING:", 'xcodebuild', [...options, ...command, ...buildOptions, ...buildSettings]);

    const xcodebuild = execa('xcodebuild', [...options, ...command, ...buildOptions, ...buildSettings], {
        reject: false,
        env: {"NSUnbufferedIO": "YES"},
    });

    xcodebuild.stdout.pipe(process.stdout);
    xcodebuild.stderr.pipe(process.stderr);

    let {exitCode} = await xcodebuild;
    if (exitCode != 0 && exitCode != 65) {
        throw Error(`xcodebuild test failed with unexpected exit code ${exitCode}`);
    }
};


const parseConfiguration = async () => {
    const configuration = {
        workspace: getOptionalInput("workspace"),
        project: getOptionalInput("project"),
        scheme: getOptionalInput("scheme"),
        configuration: getOptionalInput("configuration"),
        sdk: getOptionalInput("sdk"),
        arch: getOptionalInput("arch"),
        destination: getOptionalInput("destination"),
        clean: getOptionalBooleanInput("clean"),
        disableCodeSigning: getOptionalBooleanInput('disable-code-signing'),
        codeSignIdentity: getOptionalInput('CODE_SIGN_IDENTITY'),
        codeSigningRequired: getOptionalYesNoInput('CODE_SIGNING_REQUIRED'),
        codeSignEntitlements: getOptionalInput('CODE_SIGN_ENTITLEMENTS'),
        codeSigningAllowed: getOptionalYesNoInput('CODE_SIGNING_ALLOWED'),
        developmentTeam: getOptionalInput('development-team'),
        resultBundlePath: getOptionalInput("result-bundle-path"),
        resultBundleName: getOptionalInput("result-bundle-name"),
    };

    if (configuration.destination !== undefined) {
        configuration.destination = parseDestination(configuration.destination);
    }

    // TODO Validate the resultBundlePath

    return configuration;
}


// TODO This is now in two actions, move it to @devbotsxyz/xcresult together with xcresult.ts from xcresult-annotate?
const archiveResultBundle = async (resultBundlePath) => {
    const archivePath = resultBundlePath + ".zip";

    const args = [
        "-c",             // Create an archive at the destination path
        "-k",             // Create a PKZip archive
        "--keepParent",   // Embed the parent directory name src in dst_archive.
        resultBundlePath, // Source
        archivePath,      // Destination
    ];

    try {
        await execa("ditto", args);
    } catch (error) {
        core.error(error);
        return null;
    }

    return archivePath;
};


const uploadResultBundleArtifact = async (resultBundleArchivePath, resultBundleName) => {
    const artifactClient = artifact.create()
    /* const uploadResult = */ await artifactClient.uploadArtifact(
        resultBundleName,
        [resultBundleArchivePath],
        path.dirname(resultBundleArchivePath)
    )
};


const main = async () => {
    try {
        const configuration = await parseConfiguration();

        await buildProject(configuration);

        // Upload the results bundle as an artifact
        if (configuration.resultBundlePath !== undefined) {
            if (!fs.existsSync(configuration.resultBundlePath)) {
                throw new Error(`Could not find result bundle at ${configuration.resultBundlePath}`);
            }
            const resultBundleArchivePath = await archiveResultBundle(configuration.resultBundlePath);
            await uploadResultBundleArtifact(resultBundleArchivePath, configuration.resultBundleName);
            core.setOutput('result-bundle-path', path.resolve(configuration.resultBundlePath))
        }
    } catch (err) {
        console.log(err);
        core.setFailed(`Build failed with an unexpected error: ${err.message}`);
    }
};


main();
