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

const { parseDestination, encodeDestinationOption } = require('./destinations');


const buildProject = async ({workspace, project, scheme, configuration, sdk, arch, destination, codeSignIdentity, developmentTeam}) => {
    let options = []
    if (workspace != "") {
        options.push("-workspace", workspace);
    }
    if (project != "") {
        options.push("-project", project);
    }
    if (scheme != "") {
        options.push("-scheme", scheme);
    }
    if (configuration != "") {
        options.push("-configuration", configuration);
    }
    if (destination != "") {
        options.push("-destination", encodeDestinationOption(destination) );
    }
    if (sdk != "") {
        options.push("-sdk", sdk);
    }
    if (arch != "") {
        options.push("-arch", arch);
    }

    let buildOptions = []
    if (codeSignIdentity != "") {
        buildOptions.push(`CODE_SIGN_IDENTITY=${codeSignIdentity}`);
    }
    if (developmentTeam != "") {
        buildOptions.push(`DEVELOPMENT_TEAM=${developmentTeam}`);
    }

    console.log("EXECUTING:", 'xcodebuild', [...options, 'build', ...buildOptions]);

    const xcodebuild = execa('xcodebuild', [...options, 'build', ...buildOptions], {
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
        workspace: core.getInput("workspace"),
        project: core.getInput("project"),
        scheme: core.getInput("scheme"),
        configuration: core.getInput("configuration"),
        sdk: core.getInput("sdk"),
        arch: core.getInput("arch"),
        destination: core.getInput("destination"),
        codeSignIdentity: core.getInput('code-sign-identity'),
        developmentTeam: core.getInput('development-team'),
        resultBundlePath: core.getInput("result-bundle-path"),
        resultBundleName: core.getInput("result-bundle-name"),
    };

    if (configuration.destination !== "") {
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
        if (configuration.resultBundlePath !== "" && fs.existsSync(configuration.resultBundlePath)) {
            const resultBundleArchivePath = await archiveResultBundle(configuration.resultBundlePath);
            await uploadResultBundleArtifact(resultBundleArchivePath, configuration.resultBundleName);
        }
    } catch (err) {
        core.setFailed(`Build failed with an unexpected error: ${err.message}`);
    }
};


main();
