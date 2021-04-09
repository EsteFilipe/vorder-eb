const amazonCognitoIdentity = require('amazon-cognito-identity-js');

module.exports = function (cognitoUserPool) {

  var UserService = function () {
    this.userPool = new amazonCognitoIdentity.CognitoUserPool({
      UserPoolId : cognitoUserPool.user_pool_id,
      ClientId : cognitoUserPool.client_id // App Client id
    });
  }

  // TODO perhaps in the future I'll have to use the token received from cognito for something
  // Check https://www.npmjs.com/package/amazon-cognito-identity-js
  // Use case 4. Authenticating a user and establishing a user session with the Amazon Cognito Identity service.
  UserService.prototype.login = function(email, password) {

      var authenticationDetails = new amazonCognitoIdentity.AuthenticationDetails({
          Username : email,
          Password : password,
      });

      var userData = {
          Username : email,
          Pool : this.userPool
      };

      var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

      return new Promise((resolve, reject) => {
          cognitoUser.authenticateUser(authenticationDetails, {
              onSuccess: (result) => {
                  //console.log('successfully authenticated', result);
                  resolve(result);
              },
              onFailure: (err) => {
                  //console.log('error authenticating', err);
                  reject(err);
              }
          });
      });
  }

  // TODO sub instead of email
  UserService.prototype.logout = async function (email) {

      var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

        await cognitoUser.signOut();

        req.session.order = -1;
        req.session.cognitoData = null;

  }

  // For several Cognito examples, check:
  //https://medium.com/@prasadjay/amazon-cognito-user-pools-in-nodejs-as-fast-as-possible-22d586c5c8ec
  UserService.prototype.registerUser = function(email, password){
        var attributeList = [];
        attributeList.push(new amazonCognitoIdentity.CognitoUserAttribute({Name:"email",Value:email}));

        return new Promise((resolve, reject) => {
            this.userPool.signUp(email, password, attributeList, null, (err, result) => {
                if (err) {
                    //console.log(err.message);
                    reject(err);
                    return;
                }
                cognitoUser = result.user;
                resolve(cognitoUser)
            });
        });
  }

  // TODO INTEGRATE (THIS IS FROM https://www.npmjs.com/package/amazon-cognito-identity-js - USE CASE 11)
  UserService.prototype.changePassword = function (email, oldPassword, newPassword) {
        // TODO TURN INTO PROMISE
        var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

        cognitoUser.changePassword(oldPassword, newPassword, function(err, result) {
            if (err) {
                alert(err.message || JSON.stringify(err));
                return;
            }
            //console.log('call result: ' + result);
        });
  }

  UserService.prototype.resetPassword = function () {
    // TODO
  }

  return new UserService();
}