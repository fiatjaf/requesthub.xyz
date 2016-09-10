from flask import Flask
from flask_login import LoginManager

import settings
from helpers import User, GraphQLViewWithUserContext as GraphQLView
from schema import schema

app = Flask(__name__)
app.secret_key = settings.SECRET
app.config.from_object(settings)

app.add_url_rule(
    '/graphql',
    view_func=GraphQLView.as_view('graphql',
                                  schema=schema,
                                  pretty=settings.LOCAL,
                                  graphiql=settings.LOCAL)
)


login_manager = LoginManager()
login_manager.login_view = "github_login"
login_manager.init_app(app)


@login_manager.user_loader
def load_user(user_id):
    return User(id=user_id)
